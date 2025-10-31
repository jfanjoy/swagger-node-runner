'use strict'

const debug = require('debug')('swagger:swagger_raw')
const YAML = require('js-yaml')

// default filter just drops all the x- labels
const DROP_SWAGGER_EXTENSIONS = /^(?!x-.*)/

// default filter drops anything labeled x-private
const X_PRIVATE = ['x-private']

module.exports = function create (fittingDef, bagpipes) {
  debug('config: %j', fittingDef)

  let filter = DROP_SWAGGER_EXTENSIONS
  if (fittingDef.filter) {
    filter = new RegExp(fittingDef.filter)
  }
  debug('swagger doc filter: %s', filter)
  const privateTags = fittingDef.privateTags || X_PRIVATE
  const filteredSwagger = filterKeysRecursive(bagpipes.config.swaggerNodeRunner.swagger, filter, privateTags)

  return function swagger_raw (context, next) {
    debug('exec')

    const req = context.request
    if (!filteredSwagger) return next(null, '')

    const accept = req.headers.accept
    if (accept && accept.indexOf('yaml') !== -1) {
      const yaml = YAML.safeDump(filteredSwagger, { indent: 2 })
      context.headers['Content-Type'] = 'application/yaml'
      next(null, yaml)
    } else {
      const json = JSON.stringify(filteredSwagger, null, 2)
      context.headers['Content-Type'] = 'application/json'
      next(null, json)
    }
  }
}

function isPlainObject (value) {
  return Object.prototype.toString.call(value) === '[object Object]' &&
           value.constructor === Object
}
function filterKeysRecursive (object, dropTagRegex, privateTags) {
  if (isPlainObject(object)) {
    if (privateTags.find(tag => object[tag])) {
      object = undefined
    } else {
      const result = {}
      for (const [key, value] of Object.entries(object)) {
        if (dropTagRegex.test(key)) {
          const v = filterKeysRecursive(value, dropTagRegex, privateTags)
          if (v !== undefined) {
            result[key] = v
          } else {
            debug('dropping object at %s', key)
            delete (result[key])
          }
        } else {
          debug('dropping value at %s', key)
        }
      }
      return result
    }
  } else if (Array.isArray(object)) {
    object = object.reduce(function (reduced, value) {
      const v = filterKeysRecursive(value, dropTagRegex, privateTags)
      if (v !== undefined) reduced.push(v)
      return reduced
    }, [])
  }
  return object
}
