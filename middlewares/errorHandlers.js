export function notFoundHandler(req, res) {
  return res.status(404).json({
    error: 'Not Found',
    path: req.originalUrl,
  });
}

export function errorHandler(err, req, res, next) {
  console.error('Unhandled error:', err);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(err?.status || 500).json({
    error: err?.message || 'Internal Server Error',
  });
}