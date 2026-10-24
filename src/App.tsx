import { useEffect, useState } from 'react';
import { Game } from './game/Game';

const getIsMemex = () => {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  return path.startsWith('/memex') || hash.startsWith('#memex') || hash.startsWith('#/memex');
};

/** The whole site is the game; /memex is the Warden's console. */
export function App() {
  const [memex, setMemex] = useState(getIsMemex());
  useEffect(() => {
    const onLocation = () => setMemex(getIsMemex());
    window.addEventListener('popstate', onLocation);
    window.addEventListener('hashchange', onLocation);
    return () => {
      window.removeEventListener('popstate', onLocation);
      window.removeEventListener('hashchange', onLocation);
    };
  }, []);
  return (
    <Game
      memex={memex}
      onLeaveMemex={() => {
        window.history.pushState({}, '', '/');
        setMemex(false);
      }}
    />
  );
}

export default App;
