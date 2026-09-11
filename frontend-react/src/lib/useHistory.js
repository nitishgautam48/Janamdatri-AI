import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "../context/AuthContext";
import { KEYS, scopedGet } from "./storage";

function normalizeServerRow(a) {
  return {
    timestamp: new Date(a.created_at * 1000).toISOString(),
    severityLevel: a.severity_level,
    mri: a.mri,
    result: a.result,
  };
}

// Logged-in accounts keep their history server-side (so it survives across
// devices); guests only ever have the local copy this browser wrote. This
// mirrors the vanilla-JS app's loadServerHistory()/loadHistory() pairing.
export function useHistory() {
  const { isAuthed, identityKey } = useAuth();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      if (isAuthed) {
        try {
          const data = await api.assessmentsMine();
          if (!cancelled) setHistory(data.assessments.map(normalizeServerRow));
        } catch {
          if (!cancelled) setHistory(scopedGet(KEYS.HISTORY) || []);
        }
      } else {
        if (!cancelled) setHistory(scopedGet(KEYS.HISTORY) || []);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthed, identityKey]);

  return { history, loading };
}
