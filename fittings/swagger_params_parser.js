'use strict'

const debug = require('debug')('swagger:swagger_params_parser')
const debugContent = require('debug')('swagger:content')
const path = require('path')
const helpers = require('../lib/helpers')

const bodyParser = require('body-parser')
const async = require('async')

module.exports = function create (fittingDef, bagpipes) {
  debug('config: %j', fittingDef)

  fittingDef = Object.assign({
    jsonOptions: {
      type: ['json', 'application/*+json']
    },
    urlencodedOptions: {
      extended: false
    },
    textOptions: {
      type: '*/*'
    }
  }, fittingDef)

  return function swagger_params_parser (context, next) {
    debug('exec')

    const req = context.request
    parseRequest(req, fittingDef, function (err) {
      if (err) { /* istanbul ignore next */ return next(err) }

      const params = req.swagger.params = {}
      req.swagger.operation.parameterObjects.forEach(function (parameter) {
        params[parameter.name] = parameter.getValue(req) // note: we do not check for errors here
      })

      next(null, params)
    })
  }
}

function parseRequest (req, fittingDef, cb) {
  if (req.query && req.body && req.files) { return cb() }

  let shouldParseBody = false
  let shouldParseForm = false
  let shouldParseQuery = false
  const multFields = []

  req.swagger.operation.parameterObjects.forEach(function (parameter) {
    switch (parameter.in) {
      case 'body':
        shouldParseBody = true
        break

      case 'formData':
        shouldParseForm = true
        if (parameter.type === 'file') {
          multFields.push({ name: parameter.name })
        }
        break

      case 'query':
        shouldParseQuery = true
        break
    }
  })

  if (!req.query && shouldParseQuery) { helpers.queryString(req) }

  if (req.body || (!shouldParseBody && !shouldParseForm)) { return cb() }

  const res = null
  debugContent('parsing req.body for content-type: %s', req.headers['content-type'])
  async.series([
    function parseMultipart (cb) {
      if (multFields.length === 0) { return cb() }
      return cb(new Error('file uploads are not supported by this api'))
    },
    function parseUrlencoded (cb) {
      if (req.body || !shouldParseForm) { return cb() }
      if (skipParse(fittingDef.urlencodedOptions, req)) { return cb() } // hack: see skipParse function
      const urlEncodedBodyParser = bodyParser.urlencoded(fittingDef.urlencodedOptions)
      urlEncodedBodyParser(req, res, cb)
    },
    function parseJson (cb) {
      if (req.body) {
        debugContent('urlencoded parsed req.body:', req.body)
        return cb()
      }
      if (skipParse(fittingDef.jsonOptions, req)) { return cb() } // hack: see skipParse function
      bodyParser.json(fittingDef.jsonOptions)(req, res, cb)
    },
    function parseText (cb) {
      if (req.body) {
        debugContent('json parsed req.body:', req.body)
        return cb()
      }
      if (skipParse(fittingDef.textOptions, req)) { return cb() } // hack: see skipParse function
      bodyParser.text(fittingDef.textOptions)(req, res, function (err) {
        if (req.body) { debugContent('text parsed req.body:', req.body) }
        cb(err)
      })
    }
  ], function finishedParseBody (err) {
    return cb(err)
  })
}

// hack: avoids body-parser issue: https://github.com/expressjs/body-parser/issues/128
const typeis = require('type-is').is
function skipParse (options, req) {
  return typeof options.type !== 'function' && !typeis(req, options.type)
}
