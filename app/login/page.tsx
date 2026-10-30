import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Sign in — JusticeAI" };

export default function LoginPage() {
  return <AuthForm mode="signin" />;
}
