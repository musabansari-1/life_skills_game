/**
 * Does a character's line end the conversation? Pure and conservative.
 *
 * Speech is binding in both directions: if the NPC audibly walks out ("we're
 * done here", "I wish you the best"), the scene must end even when a weak model
 * forgot to set `wantsToEnd`. Otherwise the player hears a walk-out and the game
 * carries on as if nothing happened. Only clear walk-out language counts; a
 * friendly wrap-up after a deal is handled by acceptance, not here.
 */
const WALK_OUT =
  /\b(we'?re done( here)?|i think we'?re done|this (conversation )?is over|let'?s (leave|end) it (there|here)|i'?m going to (end|stop|leave) (this|it|things) (here|there)|i wish you (the )?(best|luck)|good ?luck with (your|the) search|i'?ll take it back to the team|this isn'?t going to work( out)?|i don'?t think this is going to work|we'?ll have to (pass|leave it)|i'?m (withdrawing|pulling) the offer|the offer is (withdrawn|off the table)|i have to (go|jump off)( now)?|i need to (go|jump off)( now)?)\b/i;

export function npcEndsConversation(speech: string): boolean {
  // Ignore conditional or hypothetical uses ("if twelve is a hard line, then we're done").
  const sentences = speech.split(/(?<=[.!?…])\s+/);
  return sentences.some((s) => WALK_OUT.test(s) && !/^\s*(if|unless|otherwise)\b/i.test(s) && !/\?\s*$/.test(s));
}
