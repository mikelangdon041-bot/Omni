import { AuthForm } from "../AuthForm";
import { register } from "../actions";

export default function RegisterPage() {
  return <AuthForm mode="register" action={register} />;
}
