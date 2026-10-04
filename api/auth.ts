import { handleGoogleAuth } from '../server/auth-proxy'

export default {
  fetch(request: Request) {
    return handleGoogleAuth(request, process.env)
  },
}
