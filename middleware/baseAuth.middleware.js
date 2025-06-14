export function basicAuthMiddleware(req, res, next) {
  const auth = req.headers['authorization'];

  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic');
    return res.status(401).send('Authentication required.');
  }

  const base64Credentials = auth.split(' ')[1];
  const [username, password] = Buffer.from(base64Credentials, 'base64').toString().split(':');

  if (
    username !== process.env.BASIC_AUTH_USER ||
    password !== process.env.BASIC_AUTH_PASS
  ) {
    return res.status(403).send('Forbidden');
  }

  next();
}
