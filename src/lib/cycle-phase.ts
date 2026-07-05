// Phasenlogik (Schritt 5): Ein offener Cycle ist vor voting_starts_at in der
// Nominierungsphase, ab dann in der Abstimmungsphase. Als Funktion außerhalb der
// Komponenten, weil die Uhrzeit request-skopierter Input ist, react-hooks/purity
// Date.now() im Render aber zu Recht anmeckert.
export function inNominationPhase(votingStartsAtIso: string): boolean {
  return Date.parse(votingStartsAtIso) > Date.now();
}

// Dead-Window (Schritt 6a): Nach ends_at ist die Abstimmung vorbei, aber der
// Cycle bleibt bis zum nächsten Cron-Lauf formal 'open'. RLS blockt Votes dann
// bereits hart — die UI zeigt solche Cycles als "Auswertung folgt".
export function votingEnded(endsAtIso: string): boolean {
  return Date.parse(endsAtIso) <= Date.now();
}
