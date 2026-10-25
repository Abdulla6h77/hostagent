import type { Domain, DomainPlan, Guest, Pick } from "@/types";

export const HEADLINES: Record<Domain, string> = { music: "Playlist direction", food: "Food plan", film: "Film night pick", vibe: "Vibe & dress code" };
interface Sample { title: string; subtitle: string; keywords: string[] }
// Hand-authored ideas, never captured Qloo responses.
const POOLS: Record<Domain, Sample[]> = {
  "music": [
    {
      "title": "Jazz Fusion Essentials",
      "subtitle": "Miles Davis, Herbie Hancock, Weather Report",
      "keywords": [
        "jazz",
        "bossa nova"
      ]
    },
    {
      "title": "Late-Night Techno",
      "subtitle": "Charlotte de Witte, Amelie Lens, Nina Kraviz",
      "keywords": [
        "techno",
        "electronic",
        "classic rock"
      ]
    },
    {
      "title": "Bossa Nova Sunset",
      "subtitle": "João Gilberto, Stan Getz, Astrud Gilberto",
      "keywords": [
        "bossa nova",
        "jazz"
      ]
    },
    {
      "title": "Soul Kitchen",
      "subtitle": "Soul and R&B for a shared table",
      "keywords": [
        "soul",
        "r&b"
      ]
    },
    {
      "title": "Indie After Hours",
      "subtitle": "Guitars and low-key discoveries",
      "keywords": [
        "indie",
        "alternative"
      ]
    },
    {
      "title": "Afrobeats Gathering",
      "subtitle": "Bright rhythms for the evening",
      "keywords": [
        "afrobeats",
        "afropop"
      ]
    },
    {
      "title": "Acoustic Table",
      "subtitle": "Folk and acoustic arrangements",
      "keywords": [
        "folk",
        "acoustic"
      ]
    },
    {
      "title": "Latin Dance Break",
      "subtitle": "Salsa and Latin pop direction",
      "keywords": [
        "salsa",
        "latin"
      ]
    },
    {
      "title": "Disco Living Room",
      "subtitle": "Disco and funk dance direction",
      "keywords": [
        "disco",
        "funk"
      ]
    },
    {
      "title": "Ambient Welcome",
      "subtitle": "Quiet textures for conversation",
      "keywords": [
        "ambient",
        "classical"
      ]
    }
  ],
  "food": [
    {
      "title": "Modern Izakaya",
      "subtitle": "Small plates, robata grill, sake pairings",
      "keywords": [
        "ramen",
        "mezze",
        "japanese"
      ]
    },
    {
      "title": "Korean BBQ",
      "subtitle": "Tabletop grill, banchan, soju cocktails",
      "keywords": [
        "bbq",
        "tacos",
        "korean"
      ]
    },
    {
      "title": "Mediterranean Mezze Spread",
      "subtitle": "Hummus, grilled halloumi, lamb kebabs, pita",
      "keywords": [
        "mezze",
        "mediterranean"
      ]
    },
    {
      "title": "Taco Sharing Table",
      "subtitle": "A build-your-own taco spread",
      "keywords": [
        "tacos",
        "mexican"
      ]
    },
    {
      "title": "Ramen Supper",
      "subtitle": "A noodle-bowl menu idea",
      "keywords": [
        "ramen",
        "japanese"
      ]
    },
    {
      "title": "Sushi Picnic",
      "subtitle": "A hand-roll and vegetable spread",
      "keywords": [
        "sushi",
        "japanese"
      ]
    },
    {
      "title": "Pizza Workshop",
      "subtitle": "Make pizzas together",
      "keywords": [
        "pizza",
        "italian"
      ]
    },
    {
      "title": "Curry Sharing Bowls",
      "subtitle": "A warming curry menu",
      "keywords": [
        "curry",
        "indian"
      ]
    },
    {
      "title": "Pho & Fresh Herbs",
      "subtitle": "A noodle-soup menu idea",
      "keywords": [
        "pho",
        "vietnamese"
      ]
    },
    {
      "title": "Plant-Based Feast",
      "subtitle": "Vegetable-led shared plates",
      "keywords": [
        "vegan",
        "vegetarian"
      ]
    }
  ],
  "film": [
    {
      "title": "Studio Ghibli Marathon",
      "subtitle": "Spirited Away, Princess Mononoke, My Neighbor Totoro",
      "keywords": [
        "studio ghibli",
        "ghibli",
        "animation"
      ]
    },
    {
      "title": "Tarantino Night",
      "subtitle": "Pulp Fiction, Kill Bill, Inglourious Basterds",
      "keywords": [
        "tarantino",
        "pulp fiction"
      ]
    },
    {
      "title": "A24 Curated Picks",
      "subtitle": "Everything Everywhere, Hereditary, Past Lives",
      "keywords": [
        "a24",
        "a24 films",
        "indie"
      ]
    },
    {
      "title": "Classic Comedy Night",
      "subtitle": "A lighthearted comedy direction",
      "keywords": [
        "comedy",
        "sitcom"
      ]
    },
    {
      "title": "Space Adventure",
      "subtitle": "A science-fiction film direction",
      "keywords": [
        "sci-fi",
        "star wars"
      ]
    },
    {
      "title": "Mystery Club",
      "subtitle": "A mystery and detective direction",
      "keywords": [
        "mystery",
        "thriller"
      ]
    },
    {
      "title": "Animated Worlds",
      "subtitle": "An animation-focused evening",
      "keywords": [
        "animation",
        "pixar"
      ]
    },
    {
      "title": "Documentary Table",
      "subtitle": "A documentary discussion night",
      "keywords": [
        "documentary",
        "nature"
      ]
    },
    {
      "title": "Superhero Evening",
      "subtitle": "A comic-book film direction",
      "keywords": [
        "marvel",
        "superhero"
      ]
    },
    {
      "title": "Musical Matinee",
      "subtitle": "A musical film direction",
      "keywords": [
        "musical",
        "broadway"
      ]
    }
  ],
  "vibe": [
    {
      "title": "Vintage Denim & Leather",
      "subtitle": "Worn-in jeans, band tees, worn boots",
      "keywords": [
        "vintage denim",
        "leather jacket",
        "denim",
        "leather"
      ]
    },
    {
      "title": "Minimalist Monochrome",
      "subtitle": "Clean lines, neutral palette, quality basics",
      "keywords": [
        "minimalism",
        "minimalist"
      ]
    },
    {
      "title": "Eclectic Festival Fit",
      "subtitle": "Patterned shirts, layered jewelry, statement outerwear",
      "keywords": [
        "streetwear",
        "vintage"
      ]
    },
    {
      "title": "Streetwear Social",
      "subtitle": "Relaxed shapes and expressive sneakers",
      "keywords": [
        "streetwear",
        "sneakers"
      ]
    },
    {
      "title": "Earth-Tone Gathering",
      "subtitle": "Warm neutrals and natural textures",
      "keywords": [
        "earth tones",
        "linen"
      ]
    },
    {
      "title": "Retro Color Party",
      "subtitle": "Playful color and vintage silhouettes",
      "keywords": [
        "retro",
        "vintage"
      ]
    },
    {
      "title": "Art-School Evening",
      "subtitle": "Expressive layers and unusual details",
      "keywords": [
        "art",
        "eclectic"
      ]
    },
    {
      "title": "Cozy Knit Night",
      "subtitle": "Soft textures and relaxed layers",
      "keywords": [
        "cozy",
        "knitwear"
      ]
    },
    {
      "title": "Tailored Evening",
      "subtitle": "Structured pieces and simple lines",
      "keywords": [
        "tailoring",
        "formal"
      ]
    },
    {
      "title": "Sporty Weekend",
      "subtitle": "Comfortable athletic accents",
      "keywords": [
        "athleisure",
        "sport"
      ]
    }
  ]
};
export const DOMAINS: Domain[] = ["music", "food", "film", "vibe"];
const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function overlaps(seed: string, keyword: string) {
  const a = ` ${normalize(seed)} `;
  const b = ` ${normalize(keyword)} `;
  return a.trim().length > 1 && (a.includes(b) || b.includes(a));
}
export function getMockPlan(guests: Guest[], reason = "Synthetic ideas; no live Qloo data."): DomainPlan[] {
  return DOMAINS.map((domain) => {
    const ranked = POOLS[domain].map((idea, index) => {
      const evidence = guests.flatMap((guest) => {
        const seeds = guest.seeds.filter((seed) => idea.keywords.some((keyword) => overlaps(seed, keyword)));
        return seeds.length ? [{ guest: guest.name, seeds }] : [];
      });
      const count = evidence.length;
      const pick: Pick = {
        title: idea.title, subtitle: idea.subtitle, affinity: null,
        bridgingGuests: evidence.map((e) => e.guest),
        why: count ? `Synthetic keyword match: ${evidence.map((e) => `${e.guest}'s “${e.seeds.join("”, “")}”`).join(" and ")}. This is a curated idea, not Qloo affinity evidence.`
          : "Synthetic hosting idea. No direct keyword match to this group's seeds; no guest affinity is claimed.",
        support: { kind: "synthetic-keyword", count, total: guests.length, rankScore: count + 1 / (index + 1) / 100 },
      };
      return pick;
    }).sort((a, b) => b.support!.rankScore - a.support!.rankScore).slice(0, 3);
    return { domain, headline: HEADLINES[domain], source: "sample", reason, picks: ranked };
  });
}
const BASELINE: Record<Domain, [string, string][]> = {
  music: [["Top 40 pop hits playlist", "General chart-pop direction"], ["Classic Rock Anthems", "Familiar guitar favorites"], ["Chill Electronic", "An easy background playlist"]],
  food: [["Italian — the safe crowd-pleaser", "Pasta, pizza, tiramisu"], ["Burger & Fries", "Classic comfort food"], ["Taco Bar", "A build-your-own spread"]],
  film: [["A Marvel rerun", "A familiar superhero film"], ["Classic Comedy", "An easy comedy night"], ["Oscar Winner", "A widely known award winner"]],
  vibe: [["Smart casual", "Nice jeans, button-down or blouse"], ["Cocktail Attire", "Dresses, slacks, blazers"], ["Come As You Are", "Whatever feels comfortable"]],
};
export const BASELINE_PLAN: DomainPlan[] = DOMAINS.map((domain) => ({
  domain, headline: HEADLINES[domain], source: "baseline",
  picks: BASELINE[domain].map(([title, subtitle]) => ({ title, subtitle,
    why: "Ranked by general popularity, not your group's actual taste.", affinity: null, bridgingGuests: [] })),
}));
