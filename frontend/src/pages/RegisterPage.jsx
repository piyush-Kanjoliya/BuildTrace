import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { Button } from '../components/ui/Button.jsx';
import { Card, CardBody } from '../components/ui/Card.jsx';
import { Input } from '../components/ui/Field.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setErrors({});
    setError(null);
    if (form.password !== form.confirm) {
      setErrors({ confirm: 'Passwords do not match' });
      return;
    }
    setSubmitting(true);
    try {
      await register({ name: form.name.trim(), email: form.email.trim(), password: form.password });
      navigate('/', { replace: true });
    } catch (err) {
      if (err.status === 422 || err.status === 400) {
        const fieldErrors = err.fieldErrors;
        setErrors(fieldErrors);
        if (!Object.keys(fieldErrors).length) setError(err.message);
      } else {
        setError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardBody className="p-6">
        <h1 className="text-lg font-semibold tracking-tight text-fg">Create your account</h1>
        <p className="mt-1 text-sm text-muted">
          You will be able to create projects, record deployments and investigate incidents.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <Input
            label="Full name"
            required
            autoComplete="name"
            value={form.name}
            onChange={set('name')}
            error={errors.name}
            placeholder="Ada Lovelace"
            data-autofocus
          />
          <Input
            label="Email"
            type="email"
            required
            autoComplete="email"
            value={form.email}
            onChange={set('email')}
            error={errors.email}
            placeholder="you@company.com"
          />
          <Input
            label="Password"
            type="password"
            required
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
            error={errors.password}
            hint="At least 8 characters."
          />
          <Input
            label="Confirm password"
            type="password"
            required
            autoComplete="new-password"
            value={form.confirm}
            onChange={set('confirm')}
            error={errors.confirm}
          />

          {error && (
            <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <Button type="submit" icon={UserPlus} loading={submitting} className="w-full" size="lg">
            Create account
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-muted">
          Already registered?{' '}
          <Link to="/login" className="cursor-pointer font-medium text-primary-300 transition-colors hover:text-primary-400">
            Sign in
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
