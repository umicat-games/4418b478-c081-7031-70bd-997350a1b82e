// The assistant's game half: what it may do, what it can see, and what
// happens when it asks.
//
// The plumbing is in `src/shell/coach.ts`; this is the part a fork rewrites.
// The rule that matters most in THIS game: Othello is the game where the
// obvious reading of the board is wrong. Whoever has more discs in the
// middlegame is usually losing, and a model looking at a picture will say
// "you are well ahead" because it can count. So the numbers that decide the
// game — how many moves each side has, how few discs you are ahead by — are
// handed over explicitly, and the counting tools are the game's, not the
// model's.
import type { AssistantSpec, Profile } from '../shell/coach';
import { BLACK, Othello, WHITE, type Player } from './rules';
import { LEVELS, type Read } from './opponent';
import { locale, t } from '../i18n';
import { letters } from './coords';

export interface Context { game: Othello | null; read: Read | null }

export interface AssistantHooks {
  setLevel(level: string): boolean;
  startGame(): boolean;
  /** Ring these cells, as written ("d3,c4"); empty clears. Returns how many
   *  were actually put on the board. */
  highlight(points: string): number;
  /** Every legal move, and what each one turns over. */
  showMoves(): { list: string; count: number } | null;
  /** The discs, right now. */
  showCount(): { black: number; white: number } | null;
}

const ACTIONS = (): AssistantSpec<Context>['actions'] => [
  { name: 'set_level', description: `How hard the opponent plays. One of: ${LEVELS.map((l) => l.id).join(', ')}.`, args: { level: 'string' } },
  { name: 'start_game', description: 'Begin a new game. Refused while one is being played.', args: {} },
  { name: 'highlight', description: 'Draw rings on cells you are talking about, e.g. "d3,c4" (coordinates only; empty string clears). It COUNTS NOTHING — for the legal moves use show_moves, for the score use show_count.', args: { points: 'string' } },
  { name: 'show_moves', description: 'Ring every legal move the student has and say how many discs each one turns over. Use this for "where can I play", "what should I consider", and any question about how much a move flips.', args: {} },
  { name: 'show_count', description: 'Say the disc count. Use it whenever the score comes up — and remember that being ahead on discs in the middlegame usually means losing.', args: {} },
];

export function othelloAssistant(hooks: AssistantHooks): AssistantSpec<Context> {
  return {
    playbook: 'coach',
    actions: ACTIONS(),

    execute(name, args, say, note): boolean {
      switch (name) {
        case 'set_level': {
          const id = String(args.level ?? '');
          if (LEVELS.some((l) => l.id === id)) hooks.setLevel(id);
          return false;
        }
        case 'start_game': {
          if (hooks.startGame()) return false;
          note('[the game] a game is in progress, so a new one was NOT started. '
            + 'The student starts one themselves, from the gear at the bottom left.');
          say(t('chat.midGame'));
          return true;
        }
        case 'show_moves': {
          const out = hooks.showMoves();
          if (!out) return false;
          note(`[the board] the student's legal moves, with what each turns over: ${out.list}`);
          say(out.count ? t('chat.moves', { list: out.list }) : t('chat.movesNone'));
          return true;
        }
        case 'show_count': {
          const out = hooks.showCount();
          if (!out) return false;
          note(`[the board] discs right now — black ${out.black}, white ${out.white}`);
          say(t('chat.count', { black: out.black, white: out.white }));
          return true;
        }
        case 'highlight': {
          const asked = String(args.points ?? '');
          const marked = hooks.highlight(asked);
          if (!asked.trim() || marked > 0) return false;
          note(`[the board] "${asked}" is not a cell on this board, so nothing was marked. Use coordinates like d3.`);
          say(t('chat.markFailed', { points: asked }));
          return true;
        }
        default:
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
        notation: 'Columns are a-h from the left, rows are 1-8 from the TOP. a1 is the top-left corner.',
      };
      if (!game) return { ...base, game: 'no game in progress' };

      const { black, white } = game.counts();
      const mine = game.legalMoves(BLACK);
      const theirs = game.legalMoves(WHITE);
      const name = (i: number): string => `${letters[i % 8]}${((i / 8) | 0) + 1}`;

      return {
        ...base,
        game: {
          position: game.diagram(),
          legend: 'Each string is one row. The FIRST row printed is row 1, the TOP of the board, '
            + 'and the LAST is row 8. The first character of every row is column a, the last is column h. '
            + 'So the top-left corner is a1 and the bottom-left is a8. "x" is the student, playing Black '
            + 'and moving first; "o" is you, playing White; "." is an empty square.',
          to_play: game.toPlay === BLACK ? 'the student' : 'the engine',
          move_number: game.moves.length,
          /** The last disc, and WHOSE it was. A bare coordinate leaves the
           *  model to infer the mover from the turn — and with passes in this
           *  game that inference is wrong more often than in most. */
          last_move: game.last !== null
            ? {
              at: name(game.last),
              by: game.at(game.last) === BLACK ? 'the student' : 'you',
              note: 'Whose move this was is stated here. Never work it out from the position.',
            }
            : null,
          empty_squares: game.empties,
          finished: game.over,
        },
        // Worked out by the game, exactly. The first two are the ones that
        // decide an Othello game and the third is the one that looks like it
        // does — which is why they are given together and labelled.
        counted_by_the_game: {
          note: 'Measured, not read off the picture. Trust these over your own counting.',
          discs: { the_student: black, you: white },
          moves_available: { the_student: mine.length, you: theirs.length },
          the_students_legal_moves: mine.map(name),
          warning: 'Being ahead on DISCS in the middlegame usually means losing. Moves available '
            + '(mobility) is what matters until the board is nearly full.',
        },
        engine_read: read
          ? {
            note: 'Measured by the engine, not by you.',
            who_is_ahead: describeLead(read),
            ...(read.exact !== undefined
              ? {
                the_ending_is_solved: `the engine has played the rest of the game out exactly: the student `
                  + `${read.exact > 0 ? `wins by ${read.exact}` : read.exact < 0 ? `loses by ${-read.exact}` : 'draws'} discs`,
              }
              : {}),
            searched_plies: read.depth,
            engine_would_play: read.candidates.slice(0, 3).map((c) => name(c.move)),
          }
          : null,
      };
    },

    summaryPrompt(previous, transcript) {
      return `Here is an Othello coach's running note on a student, and the most recent conversation.\n\n`
        + `PREVIOUS NOTE:\n${previous}\n\n`
        + `CONVERSATION:\n${transcript}\n\n`
        + `Write the updated note: at most 120 words, third person, factual. Cover what the student is here `
        + `for, roughly how strong they are and on what evidence, whether they have understood that discs `
        + `are not the point until the end, and anything they keep getting wrong. Keep anything from the `
        + `previous note that still holds. Reply with the note only.`;
    },
  };
}

/**
 * The engine's score, in words.
 *
 * Bands rather than a number: the evaluation is in units of nothing anybody
 * would recognise, and handing a model "+143" invites it to invent a meaning.
 */
function describeLead(read: Read): string {
  if (read.exact !== undefined) {
    return read.exact > 0 ? 'the student wins from here, with best play'
      : read.exact < 0 ? 'the engine wins from here, with best play' : 'a draw from here, with best play';
  }
  const s = read.score;
  const who = s > 0 ? 'the student' : 'the engine';
  const by = Math.abs(s);
  if (by < 60) return 'level';
  if (by < 300) return `${who} is a little better`;
  if (by < 900) return `${who} is clearly better`;
  return `${who} is winning`;
}

export const sideName = (p: Player): string => (p === BLACK ? 'black' : 'white');
