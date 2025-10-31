'use strict'

module.exports = {
  queryString
}

// side-effect: stores in query property on req
function queryString (req) {
  if (!req.query) {
    const url = new URL(req)
    req.query = url?.query || new URLSearchParams()
  }
  return req.query
}
