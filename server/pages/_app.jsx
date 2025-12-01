import '../styles/globals.css';
import { CalculationProvider } from '../lib/CalculationContext';

export default function App({ Component, pageProps }) {
  return (
    <CalculationProvider>
      <Component {...pageProps} />
    </CalculationProvider>
  );
}
