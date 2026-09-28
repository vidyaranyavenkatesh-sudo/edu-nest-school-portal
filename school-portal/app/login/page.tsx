import LoginForm from '@/components/LoginForm'
import { APP_NAME, LOGIN_TAGLINE } from '@/lib/config'

export default function LoginPage() {
  return <LoginForm appName={APP_NAME} tagline={LOGIN_TAGLINE} />
}
