import { doc, setDoc, deleteField, serverTimestamp } from "firebase/firestore";

export async function finalizeResult({ db, compId, phase, startNumber, user, note }) {
  const { coll, useStatusDoc } = mapPhase(phase);
  const ref = useStatusDoc
    ? doc(db, "artifacts", window.appId, "public", "data",
          "competitions", compId, `${coll}Status`, String(startNumber))
    : doc(db, "competitions", compId, coll, String(startNumber));

  await setDoc(ref, {
    finalized: true,
    finalizedAt: serverTimestamp(),
    finalizedBy: user || null,
    finalizeNote: note || null
  }, { merge: true });
}

export async function unfinalizeResult({ db, compId, phase, startNumber }) {
  const { coll, useStatusDoc } = mapPhase(phase);
  const ref = useStatusDoc
    ? doc(db, "artifacts", window.appId, "public", "data",
          "competitions", compId, `${coll}Status`, String(startNumber))
    : doc(db, "competitions", compId, coll, String(startNumber));

  await setDoc(ref, {
    finalized: deleteField(),
    finalizedAt: deleteField(),
    finalizedBy: deleteField(),
    finalizeNote: deleteField()
  }, { merge: true });
}

function mapPhase(phase) {
  // Dressyr & Precision använder status-dokument (enligt din dressyr-implementation),
  // Maraton lagras direkt på maraton-dokumentet.
  switch (phase) {
    case "dressyr":   return { coll: "dressage",  useStatusDoc: true  };
    case "precision": return { coll: "precision", useStatusDoc: true  };
    case "maraton":   return { coll: "maraton",   useStatusDoc: false };
    default: throw new Error("Bad phase");
  }
}