// Leagues imported from football-data.org, by competition code. Match lists group by these names.
export const LEAGUES: Record<string, string> = {
  PL: "Premier League", CL: "Champions League", PD: "La Liga", SA: "Serie A", BL1: "Bundesliga",
  FL1: "Ligue 1", DED: "Eredivisie", PPL: "Primeira Liga", ELC: "Championship", BSA: "Brasileirão", EC: "Euros", WC: "World Cup",
};
export const leagueName = (code?: string | null) => (code && LEAGUES[code]) || null;
/** Label for matches with no league recorded (added by hand, or imported before leagues were stored). */
export const OTHER_LEAGUE = "Other matches";
