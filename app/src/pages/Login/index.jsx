import LoginView from './LoginView';
import { useLoginController } from './useLoginController';
import { useEmergencyStatus } from '@/context/EmergencyStatusContext';

const Login = () => {
  const controller = useLoginController();
  const { isFeatureDisabled } = useEmergencyStatus();
  const loginDisabled = isFeatureDisabled('login');
  const signupDisabled = isFeatureDisabled('signup');
  const otpDisabled = isFeatureDisabled('otp');
  const passwordResetDisabled = isFeatureDisabled('password_reset');
  const emergencyActionDisabled = (
    (controller.step === 'otp' && otpDisabled)
    || (controller.step === 'reset-password' && passwordResetDisabled)
    || (controller.mode === 'signin' && loginDisabled)
    || (controller.mode === 'signup' && signupDisabled)
    || (controller.mode === 'forgot-password' && passwordResetDisabled)
  );

  return (
    <LoginView
      {...controller}
      emergencyActionDisabled={emergencyActionDisabled}
      emergencyAuthDisabled={loginDisabled}
      emergencyOtpDisabled={otpDisabled}
      emergencyPasswordResetDisabled={passwordResetDisabled}
      emergencySignupDisabled={signupDisabled}
    />
  );
};

export default Login;
