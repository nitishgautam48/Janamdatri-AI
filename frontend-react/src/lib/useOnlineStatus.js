import { useEffect, useState } from "react";

// navigator.onLine only reflects whether the device has ANY network
// interface up (e.g. still true on wifi with no real internet behind it),
// not whether our API is actually reachable - but it's the only signal
// available without polling, and it's exactly right for the common rural-
// connectivity case this is meant for (airplane mode, no signal at all),
// so it's used as a first-pass indicator; api.js's network-error tagging
// handles the rest when a request genuinely can't get through.
export function useOnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    function goOnline() { setOnline(true); }
    function goOffline() { setOnline(false); }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
