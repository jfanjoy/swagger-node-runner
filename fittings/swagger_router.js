'use strict'

const debug = require('debug')('swagger:swagger_router')
const path = require('path')
const assert = require('assert')
const SWAGGER_ROUTER_CONTROLLER = 'x-swagger-router-controller'
const CONTROLLER_INTERFACE_TYPE = 'x-controller-interface'
const allowedCtrlInterfaces = ['middleware', 'pipe', 'auto-detect']

module.exports = function create (fittingDef, bagpipes) {
  debug('config: %j', fittingDef)

  assert(Array.isArray(fittingDef.controllersDirs), 'controllersDirs must be an array')
  assert(Array.isArray(fittingDef.mockControllersDirs), 'mockControllersDirs must be an array')

  if (!fittingDef.controllersInterface) fittingDef.controllersInterface = 'middleware'
  assert(~allowedCtrlInterfaces.indexOf(fittingDef.controllersInterface),
    'value in swagger_router config.controllersInterface - can be one of ' + allowedCtrlInterfaces + ' but got: ' + fittingDef.controllersInterface
  )

  const swaggerNodeRunner = bagpipes.config.swaggerNodeRunner
  swaggerNodeRunner.api.getOperations().forEach(function (operation) {
    const interfaceType =
            operation.controllerInterface =
            operation.definition[CONTROLLER_INTERFACE_TYPE] ||
            operation.pathObject.definition[CONTROLLER_INTERFACE_TYPE] ||
            swaggerNodeRunner.api.definition[CONTROLLER_INTERFACE_TYPE] ||
            fittingDef.controllersInterface

    assert(~allowedCtrlInterfaces.indexOf(interfaceType),
      'whenever provided, value of ' + CONTROLLER_INTERFACE_TYPE + ' directive in openapi doc must be one of ' + allowedCtrlInterfaces + ' but got: ' + interfaceType)
  })

  const appRoot = swaggerNodeRunner.config.swagger.appRoot
  const dependencies = swaggerNodeRunner.config.swagger.dependencies

  const mockMode = !!fittingDef.mockMode || !!swaggerNodeRunner.config.swagger.mockMode

  let controllersDirs = mockMode ? fittingDef.mockControllersDirs : fittingDef.controllersDirs

  controllersDirs = controllersDirs.map(function (dir) {
    return path.resolve(appRoot, dir)
  })

  const controllerFunctionsCache = {}

  return function swagger_router (context, cb) {
    debug('exec')

    const operation = context.request.swagger.operation
    const controllerName = operation[SWAGGER_ROUTER_CONTROLLER] || operation.pathObject[SWAGGER_ROUTER_CONTROLLER]

    let controller

    if (controllerName in controllerFunctionsCache) {
      debug('controller in cache', controllerName)
      controller = controllerFunctionsCache[controllerName]
    } else if (controllerName) {
      debug('loading controller %s from fs: %s', controllerName, controllersDirs)
      for (let i = 0; i < controllersDirs.length; i++) {
        const controllerPath = path.resolve(controllersDirs[i], controllerName)
        try {
          const ctrlObj = require(controllerPath)
          controller = dependencies && typeof ctrlObj === 'function' ? ctrlObj(dependencies) : ctrlObj
          controllerFunctionsCache[controllerName] = controller
          debug('controller found', controllerPath)
          break
        } catch (err) {
          if (!mockMode && i === controllersDirs.length - 1) {
            return cb(err)
          }
          debug('controller not in', controllerPath)
        }
      }
    }

    if (controller) {
      const operationId = operation.definition.operationId || context.request.method.toLowerCase()
      const ctrlType =
            operation.definition['x-controller-type'] ||
            operation.pathObject.definition['x-controller-type']

      const controllerFunction = controller[operationId]

      if (controllerFunction && typeof controllerFunction === 'function') {
        if (operation.controllerInterface == 'auto-detect') {
          operation.controllerInterface =
              controllerFunction.length == 3
                ? 'middleware'
                : 'pipe'
          debug("auto-detected interface-type for operation '%s' at [%s] as '%s'", operationId, operation.pathToDefinition, operation.controllerInterface)
        }

        debug('running controller, as %s', operation.controllerInterface)
        return operation.controllerInterface == 'pipe'
          ? controllerFunction(context, cb)
          : controllerFunction(context.request, context.response, cb)
      }

      const msg = `Controller ${controllerName} doesn't export handler function ${operationId}`
      if (mockMode) {
        debug(msg)
      } else {
        return cb(new Error(msg))
      }
    }

    if (mockMode) {
      const statusCode = parseInt(context.request.get('_mockreturnstatus')) || 200

      const mimetype = context.request.get('accept') || 'application/json'
      const response = operation.getResponse(statusCode) || operation.getResponse('default')
      let mock = response.getExample(mimetype)

      if (mock) {
        debug('returning mock example value', mock)
      } else {
        const operationResponse = operation.getResponse(statusCode) || operation.getResponse('default')
        mock = operationResponse.getSample()
        debug('returning mock sample value', mock)
      }

      context.headers['Content-Type'] = mimetype
      context.statusCode = statusCode

      return cb(null, mock)
    }

    // for completeness, we should never actually get here
    cb(new Error(`No controller found for ${controllerName} in ${JSON.stringify(controllersDirs)}`))
  }
}
