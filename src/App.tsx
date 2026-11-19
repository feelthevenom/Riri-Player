import React, { useEffect, useState } from 'react';
import { ArchiveTuneProvider, useArchiveTune } from './context/ArchiveTuneContext';
import { DesktopShell } from './components/DesktopShell';
import { FullscreenCinemaPlayer } from './components/FullscreenCinemaPlayer';
import { EqualizerModal } from './components/EqualizerModal';
import { StandaloneMiniOverlayWindow } from './components/MiniPlayerOverlay';
import { HomeScreen } from './screens/HomeScreen';
import { ExploreScreen } from './screens/ExploreScreen';
import { SearchScreen } from './screens/SearchScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { DetailScreen } from './screens/DetailScreen';
import { StatsScreen } from './screens/StatsScreen';
import { PluginsScreen } from './screens/PluginsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TogetherScreen } from './screens/TogetherScreen';
import { DesktopAuthBridge } from './components/DesktopAuthBridge';
import { applyMaterialTheme } from './utils/themeEngine';

const ArchiveTuneRoutes: React.FC = () => {
  const { route } = useArchiveTune();

  return (
    <DesktopShell>
      {route === 'home' && <HomeScreen />}
      {route === 'explore' && <ExploreScreen />}
      {route === 'search' && <SearchScreen />}
      {route === 'library' && <LibraryScreen />}
      {(route === 'artist' || route === 'album' || route === 'playlist') && <DetailScreen />}
      {route === 'stats' && <StatsScreen />}
      {route === 'plugins' && <PluginsScreen />}
      {route === 'together' && <TogetherScreen />}
      {route === 'settings' && <SettingsScreen />}
    </DesktopShell>
  );
};

export const App: React.FC = () => {
  const desktopAuthPort =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('desktopAuthPort')
      : null;

  const [isMiniOverlayHash, setIsMiniOverlayHash] = useState(
    () => typeof window !== 'undefined' && window.location.hash.includes('mini-overlay'),
  );

  useEffect(() => {
    const onHash = () => setIsMiniOverlayHash(window.location.hash.includes('mini-overlay'));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (isMiniOverlayHash) {
      document.documentElement.classList.add('mini-overlay-active');
      document.body.classList.remove('bg-[var(--md-background)]');
      document.body.style.background = 'transparent';
      document.body.style.backgroundColor = 'transparent';
    } else {
      document.documentElement.classList.remove('mini-overlay-active');
    }
  }, [isMiniOverlayHash]);

  if (desktopAuthPort) {
    return <DesktopAuthBridge callbackPort={desktopAuthPort} />;
  }

  if (isMiniOverlayHash) {
    return <StandaloneMiniOverlayWindow />;
  }

  return (
    <ArchiveTuneProvider>
      <ArchiveTuneRoutes />
      <FullscreenCinemaPlayer />
      <EqualizerModal />
    </ArchiveTuneProvider>
  );
};

export default App;
