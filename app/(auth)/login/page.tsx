import { Suspense } from 'react';
import { appleSignInConfigured } from '@/lib/apple-sign-in';
import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm apple={appleSignInConfigured()} />
    </Suspense>
  );
}
