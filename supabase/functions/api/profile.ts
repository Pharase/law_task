// Name and picture come from the live LINE profile when available (the ID token copy can be stale or lack the picture).
type Claims = { sub: string; name?: string; picture?: string };
type LineProfile = { userId: string; displayName?: string; pictureUrl?: string };

/** Live profile wins only when it belongs to the logged-in user; otherwise fall back to the verified ID token. */
export function pickProfile(claims: Claims, profile: LineProfile | null): { display_name?: string; picture_url?: string } {
  const live = profile && profile.userId === claims.sub ? profile : null;
  return {
    display_name: live?.displayName || claims.name,
    picture_url: live?.pictureUrl || claims.picture,
  };
}
