import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authApi } from '../api';
import { primeCsrf } from '../lib/axios';
import { useAuthStore } from '../stores/authStore';
import { useServerHealth } from '../hooks/useServerHealth';
import toast from 'react-hot-toast';
import {
  Eye, EyeOff, Loader2, WifiOff, User, Lock, LogIn, Store, BarChart3, Settings,
} from 'lucide-react';
import { frontOfHousePath, setChosenDestination } from '../lib/landing';

const schema = z.object({
  username: z.string().min(1, 'Username or email required'),
  password: z.string().min(1, 'Password required'),
});
type FormData = z.infer<typeof schema>;
type Side = 'front' | 'back';

// "Remember me" keeps the username and chosen side on this device (never the password).
const REMEMBER_KEY = 'core-login-remember';
function loadRemembered(): { username: string; side: Side } | null {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function Logo({ size = 64 }: { size?: number }) {
  return (
    <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width={size} height={size}>
      <path d="M18 2L32.5 10.25V26.75L18 35L3.5 26.75V10.25Z" fill="#2563eb" />
      <circle cx="18" cy="18" r="8" stroke="white" strokeWidth="2.5" fill="none" />
      <circle cx="18" cy="18" r="4" fill="white" opacity="0.35" />
    </svg>
  );
}

export default function LoginPage() {
  const remembered = loadRemembered();
  const [showPw, setShowPw] = useState(false);
  const [side, setSide] = useState<Side>(remembered?.side ?? 'front');
  const [remember, setRemember] = useState(!!remembered);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const { isServerUp } = useServerHealth();

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: { username: remembered?.username ?? '' },
  });

  const askAdmin = () => toast('Ask your administrator to reset it under Users.', { icon: '🔑', duration: 5000 });

  const onSubmit = async (data: FormData) => {
    try {
      await primeCsrf();
      const res = await authApi.login(data as any);
      const { user } = res.data.data;

      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username: data.username, side }));
        else localStorage.removeItem(REMEMBER_KEY);
      } catch { /* storage unavailable — remembering is only a convenience */ }

      // Open the side they picked, if their role allows it; otherwise the side they can use.
      const isAdmin = user.roles?.includes('admin');
      const can = (perm: string) => isAdmin || (user.permissions ?? []).includes(perm);
      const tillOnly = user.roles?.includes('cashier') || user.roles?.includes('waiter');
      const canFront = can('create_sales');
      const canBack = can('view_dashboard') && !tillOnly;
      let destination = side === 'front' ? frontOfHousePath(user) : '/';
      if (side === 'front' && !canFront) {
        destination = '/';
        toast('You don\'t have Front of House access — opening Back of House.', { icon: 'ℹ️' });
      } else if (side === 'back' && !canBack) {
        destination = frontOfHousePath(user);
        toast('You don\'t have Back of House access — opening Front of House.', { icon: 'ℹ️' });
      }

      setChosenDestination(destination);
      setAuth(user);
      toast.success(`Welcome back, ${user.name}!`);
      navigate(destination, { replace: true });
    } catch (err: any) {
      if (!err.response) {
        toast.error('Cannot reach the Core POS server. Double-click the "Core" shortcut on your Desktop to start it, then try again.');
      } else {
        // 422 = the credentials didn't match; anything else, show the server's reason (e.g. account disabled).
        toast.error(err.response?.status === 422 ? 'Incorrect username or password.' : (err.response?.data?.message || 'Could not sign in.'));
      }
    }
  };

  const sideCards: Array<{ key: Side; title: string; icon: React.ReactNode }> = [
    { key: 'front', title: 'Front of House', icon: <Store size={44} strokeWidth={1.8} /> },
    {
      key: 'back', title: 'Back of House',
      icon: (
        <span className="relative inline-block">
          <BarChart3 size={44} strokeWidth={1.8} />
          <Settings size={20} strokeWidth={2.4} className="absolute -right-1.5 -bottom-1 bg-white rounded-full" />
        </span>
      ),
    },
  ];

  return (
    <div className="login-screen relative min-h-screen overflow-hidden" style={{ background: 'linear-gradient(135deg, #eef4ff 0%, #f6f9ff 45%, #e8f0fe 100%)' }}>
      {/* Soft background shapes */}
      <div className="pointer-events-none absolute -top-40 -left-40 w-[520px] h-[520px] rounded-full bg-blue-200/40 blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 left-1/3 w-[420px] h-[420px] rounded-full bg-indigo-200/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 right-0 w-[520px] h-[520px] rounded-full bg-sky-200/40 blur-3xl" />

      <div className="relative min-h-screen flex items-center justify-center px-4 sm:px-8 py-8">
        {/* Centred sign-in card */}
        <div className="w-full max-w-xl bg-white/95 backdrop-blur rounded-2xl shadow-2xl shadow-blue-900/10 border border-white p-6 sm:p-10">
          {!isServerUp && (
            <div className="mb-6 flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <WifiOff size={18} className="text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-700">Server not running</p>
                <p className="text-xs text-red-600 mt-0.5">
                  Double-click the <strong>Core</strong> shortcut on your Desktop to start it, then refresh this page.
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-center gap-3">
            <Logo size={52} />
            <div>
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-none">Core <span className="text-blue-600">POS</span></h1>
              <p className="text-sm text-slate-600 tracking-[0.12em] mt-1.5">Simple. Smart. Sales.</p>
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit as any)} className="mt-8 space-y-5">
            {/* Front / Back of House */}
            <div>
              <p className="font-bold text-slate-900">Select Your Role</p>
              <div className="grid grid-cols-2 gap-3 mt-3" role="radiogroup" aria-label="Front or Back of House">
                {sideCards.map(({ key, title, icon }) => {
                  const active = side === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setSide(key)}
                      className={`login-role relative flex flex-col items-center text-center gap-2 rounded-xl border-2 px-3 py-5 transition-colors touch-manipulation ${
                        active ? 'border-blue-600 bg-blue-50/60' : 'border-slate-200 bg-white hover:border-blue-300'
                      }`}
                    >
                      <span className={`absolute top-3 right-3 w-5 h-5 rounded-full border-2 flex items-center justify-center ${active ? 'border-blue-600' : 'border-slate-300'}`}>
                        {active && <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />}
                      </span>
                      <span className={active ? 'text-blue-600' : 'text-slate-500'}>{icon}</span>
                      <span className="font-bold text-slate-900">{title}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1.5">Username / Email</label>
              <div className="relative">
                <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  {...register('username')}
                  type="text"
                  autoComplete="username"
                  placeholder="Enter username or email"
                  className="w-full border border-slate-200 rounded-lg pl-11 pr-4 py-3.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              {errors.username && <p className="text-red-500 text-xs mt-1">{errors.username.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1.5">Password</label>
              <div className="relative">
                <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  {...register('password')}
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="w-full border border-slate-200 rounded-lg pl-11 pr-12 py-3.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button type="button" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide password' : 'Show password'}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="w-4 h-4 accent-blue-600" />
                Remember me
              </label>
              <button type="button" onClick={askAdmin} className="text-sm text-blue-600 hover:underline">Forgot password?</button>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !isServerUp}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg shadow-blue-600/25"
            >
              {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />}
              {!isServerUp ? 'Server offline' : isSubmitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}
