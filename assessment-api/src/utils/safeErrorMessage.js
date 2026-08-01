// error.status is only ever set by app code deliberately throwing a controlled,
// user-facing error (e.g. HttpError). Anything without it is an unexpected error
// (Mongoose, filesystem, network, etc.) whose .message can contain internals that
// shouldn't reach the client.
export function safeErrorMessage(error) {
  return error.status ? error.message : "Internal server error";
}
