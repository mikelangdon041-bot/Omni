import { AuthForm } from "../AuthForm";
import { login } from "../actions";

export default function LoginPage() {
  return <AuthForm mode="login" action={login} />;
}
