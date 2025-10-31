'use strict'

module.exports = init

const debug = require('debug')('swagger')
const debugContent = require('debug')('swagger:content')
const util = require('util')
const EventEmitter = require('events').EventEmitter

function init (runner) {
  return new Middleware(runner)
}

function Middleware (runner) {
  this.runner = runner

  this.middleware = function middleware () {
    return function middleware (req, res, next) { // flow back to connect pipe
      const operation = runner.getOperation(req)

      if (!operation) {
        const path = runner.getPath(req)
        if (!path) { return next() }

        if (!path['x-swagger-pipe'] && req.method !== 'OPTIONS') {
          const msg = `Path [${path.path}] defined in Swagger, but ${req.method} operation is not.`
          const err = new Error(msg)
          err.statusCode = 405
          err.status = err.statusCode // for Sails, see: https://github.com/theganyo/swagger-node-runner/pull/31

          const allowedMethods = path.operationObjects.map(function (operation) {
            return operation.method.toUpperCase()
          })
          err.allowedMethods = allowedMethods

          res.setHeader('Allow', allowedMethods.sort().join(', '))
          return next(err)
        }
      }

      runner.applyMetadata(req, operation, function (err) {
        if (err) { /* istanbul ignore next */ return next(err) }

        const pipe = runner.getPipe(req)
        if (!pipe) {
          var err = new Error('No implementation found for this path.')
          err.statusCode = 405
          return next(err)
        }

        const context = {
          // system values
          _errorHandler: runner.defaultErrorHandler(),
          request: req,
          response: res,

          // user-modifiable values
          input: undefined,
          statusCode: undefined,
          headers: {},
          output: undefined
        }

        context._finish = function finishConnect (ignore1, ignore2) { // must have arity of 2
          debugContent('exec', context.error)
          if (context.error) { return next(context.error) }

          try {
            const response = context.response

            if (context.statusCode) {
              debug('setting response statusCode: %d', context.statusCode)
              response.statusCode = context.statusCode
            }

            if (context.headers) {
              debugContent('setting response headers: %j', context.headers)
              for (const [name, value] of Object.entries(context.headers)) {
                response.setHeader(name, value)
              }
            }

            if (undefined === context.output) { return next() }

            let contentType = response.getHeader('content-type')
            if (!contentType) {
              contentType = request.headers.accept
              if (contentType == '*/*') contentType = operation.produces[0]
              if (contentType) response.setHeader('content-type', contentType)
            }

            const body = translate(context.output, contentType)

            debugContent('sending response body: %s', body)
            response.end(body)
          } catch (err) {
            /* istanbul ignore next */
            next(err)
          }
        }

        /* istanbul ignore next */
        const listenerCount = (runner.listenerCount)
          ? runner.listenerCount('responseValidationError') // Node >= 4.0
          : EventEmitter.listenerCount(runner, 'responseValidationError') // Node < 4.0
        if (listenerCount) {
          hookResponseForValidation(context, runner)
        }

        runner.bagpipes.play(pipe, context)
      })
    }
  }

  this.register = function register (app) {
    app.use(this.middleware())
  }
}

function translate (output, mimeType) {
  if (typeof output !== 'object') { return output }

  switch (true) {
    case /json/.test(mimeType):
      return JSON.stringify(output)

    default:
      return util.inspect(output)
  }
}

function hookResponseForValidation (context, eventEmitter) {
  debug('add response validation hook')
  const res = context.response
  const end = res.end
  const write = res.write
  let written
  res.write = function hookWrite (chunk, encoding, callback) {
    if (written) {
      written = ''
      res.write = write
      res.end = end
      debug('multiple writes, will not validate response')
    } else {
      written = chunk
    }
    write.apply(res, arguments)
  }
  res.end = function hookEnd (data, encoding, callback) {
    res.write = write
    res.end = end
    if (written && data) {
      debug('multiple writes, will not validate response')
    } else if (!context.request.swagger.operation) {
      debug('not a swagger operation, will not validate response')
    } else {
      debug('validating response')
      try {
        const headers = res._headers || res.headers || {}
        const body = data || written
        debugContent('response body type: %s value: %s', typeof body, body)
        const validateResult = context.request.swagger.operation.validateResponse({
          statusCode: res.statusCode,
          headers,
          body
        })
        debug('validation result:', validateResult)
        if (validateResult.errors.length || validateResult.warnings.length) {
          debug('emitting responseValidationError')
          eventEmitter.emit('responseValidationError', validateResult, context.request, res)
        }
      } catch (err) {
        /* istanbul ignore next */
        console.error(err.stack)
      }
    }
    end.apply(res, arguments)
  }
}
