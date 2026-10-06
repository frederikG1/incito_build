import { useEffect, useState, type ReactNode } from 'react';
import { signInWith, startSession, useSession } from './session.js';

/** Nothing of the studio until the server says it may be shown. */
export function SessionGate({ children }: { children: ReactNode }) {
  const session = useSession();
  useEffect(() => { void startSession(); }, []);
  if (session.state === 'open' || session.state === 'signed-in') return <>{children}</>;
  if (session.state === 'asking') return null;
  if (session.state === 'unreachable') {
    return (
      <main className="signin">
        <div className="signin__card">
          <h1>Incitio</h1>
          <p className="signin__said">Serveren svarer ikke ({session.said}).</p>
          <button className="go" onClick={() => void startSession()}>Prøv igen</button>
        </div>
      </main>
    );
  }
  return <SignIn said={session.said} />;
}

function SignIn({ said }: { said: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <main className="signin">
      <form
        className="signin__card"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          await signInWith(email, password);
          setBusy(false);
          setPassword('');
        }}
      >
        <h1>Incitio</h1>
        <label>
          <span>E-mail</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          <span>Adgangskode</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {said && <p className="signin__said" role="alert">{said}</p>}
        <button className="go" type="submit" disabled={busy}>{busy ? 'Logger ind…' : 'Log ind'}</button>
      </form>
    </main>
  );
}
