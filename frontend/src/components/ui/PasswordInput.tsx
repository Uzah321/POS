import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/** A password input with an eye button to show/hide what's been typed. Works with react-hook-form's register(). */
const PasswordInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => {
    const [show, setShow] = useState(false);
    return (
      <div className="relative">
        <input ref={ref} {...props} type={show ? 'text' : 'password'} className={`${className} pr-10`} />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          title={show ? 'Hide password' : 'Show password'}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    );
  }
);
PasswordInput.displayName = 'PasswordInput';

export default PasswordInput;
