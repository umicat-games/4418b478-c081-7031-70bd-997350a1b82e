// The assistant's game half: what it may do, what it can see, and what
// happens when it asks.
//
// The plumbing is in `src/shell/coach.ts`; this file is the part a fork
// rewrites. Three rules held across every game in this family and they are
// worth keeping:
//
//   **Anything that must be RIGHT is a tool, not a sentence.** A model asked
//   to read threes off a text diagram answers confidently and wrongly, every
//   time. `show_threats` hands the question to the referee and the GAME says
//   the answer out loud.
//
//   **Never report a mark that did not happen.** `highlight` returns how many
//   cells it actually marked; zero says so, to the player and to the model.
//
//   **The observation is small.** It ships with every message, so anything in
//   it is paid for on every turn of the conversation.
import type { AssistantSpec, Profile } from '../shell/coach';
import { BLACK, Gomoku, WHITE, type Player } from './rules';
import { LEVELS, type Read } from './opponent';
import { SIZES } from './rules';
import { locale, t } from '../i18n';

export interface Context { game: Gomoku | null; read: Read | null }

/** What the game lets the assistant change or ask for. Each validates, and
 *  may say no. */
export interface AssistantHooks {
  setBoardSize(size: number): boolean;
  setLevel(level: string): boolean;
  startGame(): boolean;
  /** Ring these cells, as written ("H8,J10"); empty clears. Returns how many
   *  were actually put on the board. */
  highlight(points: string): number;
  /** Ring everything either side is threatening, and say it. The referee
   *  works it out; this returns it already in words. */
  showThreats(): { mine: string; theirs: string } | null;
}

const ACTIONS = (): AssistantSpec<Context>['actions'] => [
  { name: 'set_board_size', description: `Change the board to ${SIZES.join(', ')} lines. Only between games.`, args: { size: 'integer' } },
  { name: 'set_level', description: `How hard the opponent plays. One of: ${LEVELS.map((l) => l.id).join(', ')}.`, args: { level: 'string' } },
  { name: 'start_game', description: 'Begin a new game on the current board.', args: {} },
  // The description is what the model reads when it picks a tool, so it says
  // what this one does NOT do. In the Go game the marking tool kept being
  // chosen for questions that needed counting, and it answered nothing.
  { name: 'highlight', description: 'Draw rings on points you are talking about, e.g. "H8,J10" (coordinates only; empty string clears). It WORKS NOTHING OUT — for threats use show_threats.', args: { points: 'string' } },
  { name: 'show_threats', description: 'Ring every point where either side can make five, an unanswerable four, or an open three, and say them. Use this for "am I safe", "what is he threatening", "what should I block", and any question about threes and fours.', args: {} },
];

export function gomokuAssistant(hooks: AssistantHooks): AssistantSpec<Context> {
  return {
    playbook: 'coach',
    actions: ACTIONS(),

    execute(name, args, say, note): boolean {
      switch (name) {
        case 'set_board_size': {
          const size = Number(args.size);
          if (SIZES.includes(size as typeof SIZES[number])) hooks.setBoardSize(size);
          return false;
        }
        case 'set_level': {
          const id = String(args.level ?? '');
          if (LEVELS.some((l) => l.id === id)) hooks.setLevel(id);
          return false;
        }
        case 'start_game': {
          if (hooks.startGame()) return false;
          // The game refused: there are stones on the board. This used to go
          // through, and a game in progress simply disappeared.
          note('[the game] a game is in progress, so a new one was NOT started. '
          + 'The student starts one themselves, from the gear at the bottom left.');
          say(t('chat.midGame'));
          return true;
        }
        case 'show_threats': {
          const out = hooks.showThreats();
          if (!out) return false;
          // Told back to the model, so its NEXT sentence uses the real list,
          // and said out loud by the GAME, now — the model has finished its
          // turn, and waiting for it to speak again leaves the player with
          // rings and no sentence.
          note(`[the board] the student threatens: ${out.mine}. you threaten: ${out.theirs}`);
          say(t('chat.threats', { mine: out.mine, theirs: out.theirs }));
          return true;
        }
        case 'highlight': {
          const asked = String(args.points ?? '');
          const marked = hooks.highlight(asked);
          if (!asked.trim() || marked > 0) return false;
          note(`[the board] "${asked}" is not a point on this board, so nothing was marked. Use coordinates like H8.`);
          say(t('chat.markFailed', { points: asked }));
          return true;
        }
        default:
          // An unknown tool name is the model inventing a capability.
          // Ignoring it is the safety story working.
          console.warn('[assistant] ignored unknown action', name);
          return false;
      }
    },

    observe(ctx: Context, profile: Profile<never>): unknown {
      const { game, read } = ctx;
      const base = {
        language: {
          the_game_is_in: locale(),
          rule: 'Reply in the language the student writes to you in — and only their own typed messages count. '
            + 'A line that starts with [the game] is the GAME telling you what just happened, written in English '
            + 'for you alone; it never sets the language. If the student has not written anything yet, use the '
            + 'language above.',
        },
        student: {
          here_for: profile.mode,
          games_played: profile.gamesPlayed,
          what_you_know_about_them: profile.summary || '(you have not met them before)',
        },
        settings: { opponent_level: profile.level },
        notation: 'Columns are letters from the left (I is NOT skipped), rows are numbers counting UP from the bottom.',
      };
      if (!game) return { ...base, game: 'no game in progress' };

      const threats = (p: Player): unknown => {
        const th = game.threats(p);
        const say = (list: number[]): string[] => list.slice(0, 6).map((i) => name(game, i));
        return { five_at: say(th.win), unanswerable_four_at: say(th.openFour), open_three_at: say(th.openThree) };
      };

      return {
        ...base,
        game: {
          size: game.size,
          // A picture of the position beats a move list for a model trying to
          // answer "what is going on here". Row 1 of the array is the TOP of
          // the board, which is row `size` when spoken.
          position: game.diagram(),
          // How to read it, completely. Half a legend is how the Go game's
          // assistant ended up describing the wrong side of the board.
          legend: `Each string is one row. The FIRST row printed is the TOP of the board — `
            + `row ${game.size} — and the LAST is row 1. The first character of every row is `
            + `column A, the last is column ${'ABCDEFGHIJKLMNO'[game.size - 1]}. So the top-left `
            + `point is A${game.size} and the bottom-left is A1. "x" is the student, playing `
            + `Black and moving first; "o" is you, playing White; "." is an empty point.`,
          to_play: game.toPlay === BLACK ? 'the student' : 'the engine',
          move_number: game.moves.length,
          /** The last stone, and WHOSE it was. Left as a bare coordinate the
           *  model works out whose it was from the turn and gets it backwards
           *  — which in the chess game came out as praising the student for a
           *  capture the engine had just made against them. */
          last_move: game.last !== null
            ? {
              at: name(game, game.last),
              by: game.toPlay === BLACK ? 'the opponent' : 'the student',
              note: 'Whose move this was is stated here. Never work it out from the position.',
            }
            : null,
          finished: game.over,
        },
        // Measured by the referee, not by you — and this is the part you are
        // most likely to get wrong on your own.
        threats: {
          note: 'Worked out by the game, exactly. Trust these over your own reading of the position.',
          the_student: threats(BLACK),
          you: threats(WHITE),
        },
        engine_read: read
          ? {
            note: 'Measured by the engine, not by you.',
            who_is_ahead: describeLead(read),
            searched_plies: read.depth,
            engine_would_play: read.candidates.slice(0, 3).map((c) => name(game, c.move)),
          }
          : null,
      };
    },

    summaryPrompt(previous, transcript) {
      return `Here is a gomoku (five in a row) coach's running note on a student, and the most recent conversation.\n\n`
        + `PREVIOUS NOTE:\n${previous}\n\n`
        + `CONVERSATION:\n${transcript}\n\n`
        + `Write the updated note: at most 120 words, third person, factual. Cover what the student is here `
        + `for (learning or just playing), roughly how strong they are and on what evidence, whether they see `
        + `threats coming, and anything they keep getting wrong. Keep anything from the previous note that `
        + `still holds. Reply with the note only.`;
    },
  };
}

/** A cell, as everyone here says it. Defined against the board in play,
 *  because "H8" is a different place on a 13 line board. */
function name(game: Gomoku, i: number): string {
  return `${'ABCDEFGHIJKLMNOPQRS'[game.xOf(i)]}${game.size - game.yOf(i)}`;
}

/**
 * The engine's score, in words.
 *
 * Deliberately not a number: gomoku evaluation units are shapes, and "+12,000"
 * means nothing to a player and invites the model to invent an
 * interpretation. Bands, derived from the measurement, are honest and usable.
 */
function describeLead(read: Read): string {
  if (read.decided === 1) return 'the student has a forced win';
  if (read.decided === -1) return 'the engine has a forced win';
  const s = read.score;
  const who = s > 0 ? 'the student' : 'the engine';
  const by = Math.abs(s);
  if (by < 2_000) return 'level';
  if (by < 15_000) return `${who} is a little better`;
  if (by < 60_000) return `${who} is clearly better`;
  return `${who} is winning`;
}
