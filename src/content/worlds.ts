/**
 * World & location content. Adding a world = add an entry here (and, for
 * playable worlds, at least one location + quest). Locked worlds render on the
 * map to communicate the universe's scale.
 */
import type { LocationDefinition, WorldDefinition } from "@/engine/types/world";

export const WORLDS: WorldDefinition[] = [
  {
    id: "everyday_district",
    name: "Everyday District",
    tagline: "Where the small conversations live.",
    description: "Neighbours, favours, first impressions. The low-stakes places where habits form.",
    status: "open",
    map: { x: 18, y: 70, size: "md" },
    accent: "#c9a66b",
  },
  {
    id: "career_city",
    name: "Career City",
    tagline: "Offers, deadlines and the people who decide.",
    description: "Nova Labs, its platform team and its biggest customer. The conversations that decide whether you get in, and who you become once you do.",
    status: "open",
    map: { x: 46, y: 46, size: "lg" },
    accent: "#8fb3c9",
  },
  {
    id: "influence_arena",
    name: "Negotiation Arena",
    tagline: "Where a good argument is not enough.",
    description: "Renewals, buyers and sceptics. Every number has someone on the other side of it.",
    status: "locked",
    map: { x: 78, y: 68, size: "md" },
    accent: "#c98f8f",
  },
  {
    id: "leadership_tower",
    name: "Leadership Tower",
    tagline: "People will follow. Or not.",
    description: "Teams, hard decisions, and the weight of being the one who decides.",
    status: "locked",
    map: { x: 64, y: 18, size: "md" },
    accent: "#a89bc9",
  },
  {
    id: "speaking_stage",
    name: "Speaking Stage",
    tagline: "A room, a microphone, and no second take.",
    description: "Public speaking and storytelling in front of audiences that react.",
    status: "locked",
    map: { x: 26, y: 24, size: "sm" },
    accent: "#c9b98f",
  },
  {
    id: "founder_valley",
    name: "Founder Valley",
    tagline: "Pitch, hire, sell, survive.",
    description: "Investors, co-founders and first customers.",
    status: "locked",
    map: { x: 86, y: 34, size: "sm" },
    accent: "#8fc9a8",
  },
];

export const LOCATIONS: LocationDefinition[] = [
  {
    id: "everyday_district.neighbourhood",
    worldId: "everyday_district",
    name: "Lakeview Apartments",
    description: "Your building. Stairwells, lifts, and the people you keep bumping into.",
  },
  {
    id: "career_city.nova_labs_hr",
    worldId: "career_city",
    name: "Nova Labs — Talent Office",
    description: "Glass meeting rooms on the 14th floor. Offers are made and unmade here.",
  },
  {
    id: "career_city.nova_labs_platform",
    worldId: "career_city",
    name: "Nova Labs — Platform Team",
    description: "Standing desks, a whiteboard nobody erases, and a sprint that is always behind.",
    lockedByDefault: true,
  },
  {
    id: "career_city.nova_labs_product",
    worldId: "career_city",
    name: "Nova Labs — Product Floor",
    description: "Customer names on every whiteboard. Nora's desk faces the window, and the Meridian account is always open on it.",
    lockedByDefault: true,
  },
  {
    id: "career_city.meridian_room",
    worldId: "career_city",
    name: "Nova Labs — Customer Call Room",
    description: "A small glass room with a large screen. Conversations in here get quoted back in renewal meetings.",
    lockedByDefault: true,
  },
  {
    id: "influence_arena.forum",
    worldId: "influence_arena",
    name: "The Forum",
    description: "Where cases are made and picked apart.",
    lockedByDefault: true,
  },
];

export function getWorld(id: string) {
  return WORLDS.find((w) => w.id === id);
}
export function getLocation(id: string) {
  return LOCATIONS.find((l) => l.id === id);
}
