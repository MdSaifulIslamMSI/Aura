import LoginView from './LoginView';
import { useLoginController } from './useLoginController';

const Login = () => {
  const controller = useLoginController();
  return <LoginView {...controller} />;
};

export default Login;
