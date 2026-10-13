import { Suspense } from 'react';
import { appleSignInConfigured } from '@/lib/apple-sign-in';
import { RegisterForm } from './register-form';

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm apple={appleSignInConfigured()} />
    </Suspense>
  );
}
