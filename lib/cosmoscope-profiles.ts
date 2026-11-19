import type { BodyName } from "./cosmoscope";

/**
 * Cosmoscope's long-form profiles: what each world is like, what to look for on it, and who has
 * been there. Figures from NASA's planetary fact sheets and mission pages; moon counts as
 * recognised by the IAU's Minor Planet Center in 2025.
 */

export interface Feature {
  title: string;
  text: string;
  /** A view the 3D scene can fly to for this feature. */
  look?: "storm" | "rings" | "north" | "south" | "plates";
}

export interface Mission {
  name: string;
  when: string;
  what: string;
}

export interface Profile {
  tagline: string;
  /** Paragraphs. */
  overview: string[];
  /** Mass in Earths. */
  massEarths: number;
  /** Mean density, g/cm³. */
  density: number;
  /** Surface (or 1-bar level) gravity, m/s². */
  gravity: number;
  /** Escape velocity, km/s. */
  escape: number;
  /** Mean distance from the Sun, million km (0 for the Sun). */
  orbitMkm: number;
  /** Lowest and highest temperatures, °C, where they mean something. */
  tempRange?: [number, number];
  /** Main gases. */
  atmosphere: string;
  /** Surface pressure, as text. */
  pressure: string;
  /** What it is made of, inside. */
  interior: string;
  features: Feature[];
  missions: Mission[];
  /** Colours for its thumbnail, light to dark. */
  swatch: [string, string];
}

export const PROFILES: Record<BodyName, Profile> = {
  Sun: {
    tagline: "The star that holds it all together",
    overview: [
      "The Sun is a ball of hot plasma 1.39 million km across, a little over 4.6 billion years old and about halfway through its life. It holds 99.8% of the mass in the Solar System, and its gravity keeps everything on this map in orbit.",
      "In its core, at around 15 million °C, it fuses about 600 million tonnes of hydrogen into helium every second. The energy takes tens of thousands of years to work its way out, then crosses to Earth as sunlight in about 8 minutes 20 seconds.",
      "Its magnetic activity rises and falls in a cycle of about 11 years. Solar Cycle 25 reached its maximum around 2024–2025, bringing more sunspots, flares and auroras.",
    ],
    massEarths: 333_000,
    density: 1.41,
    gravity: 274,
    escape: 617.7,
    orbitMkm: 0,
    atmosphere: "Hydrogen 73%, helium 25% (by mass)",
    pressure: "No surface",
    interior: "A fusing core, a radiative zone and a churning convective zone under the visible surface, the photosphere.",
    features: [
      { title: "Granulation", text: "The surface is tiled with granules, convection cells about 1,000 km across, each a column of hot plasma rising and sinking in minutes." },
      { title: "Sunspots", text: "Darker, cooler patches where magnetic fields block the heat from below. Their numbers track the 11-year cycle." },
      { title: "The corona", text: "The outer atmosphere is over a million degrees, hundreds of times hotter than the surface. Why is still being worked out; Parker Solar Probe flies through it to find out." },
    ],
    missions: [
      { name: "SOHO", when: "1995–today", what: "ESA/NASA observatory watching the Sun from 1.5 million km sunward of Earth." },
      { name: "Parker Solar Probe", when: "2018–today", what: "Passed 6.1 million km from the surface in December 2024, closer than anything before it." },
      { name: "Solar Orbiter", when: "2020–today", what: "ESA's first images of the Sun's poles, from a tilted orbit." },
    ],
    swatch: ["#fff1c4", "#e8781f"],
  },
  Mercury: {
    tagline: "A scorched iron world racing round the Sun",
    overview: [
      "Mercury is the smallest planet and the closest to the Sun, circling it every 88 days. It is barely larger than our Moon, but so dense that an iron core fills most of its inside.",
      "With almost no atmosphere to hold heat, its surface swings from about 430 °C in the day to −180 °C at night. Even so, ice lies in craters near its poles that never see sunlight.",
      "It spins exactly three times for every two laps of the Sun, so one day, sunrise to sunrise, lasts two of its years.",
    ],
    massEarths: 0.055,
    density: 5.43,
    gravity: 3.7,
    escape: 4.3,
    orbitMkm: 57.9,
    tempRange: [-180, 430],
    atmosphere: "A trace exosphere: oxygen, sodium, hydrogen, helium, potassium",
    pressure: "Almost a vacuum",
    interior: "A huge iron core reaching about 85% of the way to the surface, under a thin rocky mantle and crust.",
    features: [
      { title: "Caloris Basin", text: "One of the largest impact craters known, about 1,550 km across, made by an asteroid early in the Solar System's history." },
      { title: "Polar ice", text: "MESSENGER found water ice in craters at the poles where sunlight never reaches the floor." },
      { title: "A shrinking planet", text: "As its core cooled, Mercury shrank. Cliffs hundreds of kilometres long, wrinkles in its crust, record it." },
    ],
    missions: [
      { name: "Mariner 10", when: "1974–1975", what: "The first visit: three flybys mapping just under half the surface." },
      { name: "MESSENGER", when: "2011–2015", what: "The first spacecraft to orbit Mercury; mapped all of it and found its polar ice." },
      { name: "BepiColombo", when: "Launched 2018", what: "ESA and JAXA's two orbiters, arriving in late 2026." },
    ],
    swatch: ["#c9c3bb", "#5f5a55"],
  },
  Venus: {
    tagline: "Earth's twin, turned into a furnace",
    overview: [
      "Venus is almost the same size as Earth, but nothing else is alike. A carbon-dioxide atmosphere 90 times as heavy as ours traps the Sun's heat, making the surface about 464 °C, hot enough to melt lead, day and night, pole to pole.",
      "Its clouds are made of sulphuric acid. They hide the ground completely, so what we know of the surface comes from radar and from the few Soviet landers that survived there for an hour or two.",
      "Venus spins backwards, and so slowly that one turn takes longer than its year. Its upper clouds, though, race round the planet in four days.",
    ],
    massEarths: 0.815,
    density: 5.24,
    gravity: 8.9,
    escape: 10.4,
    orbitMkm: 108.2,
    atmosphere: "Carbon dioxide 96.5%, nitrogen 3.5%; clouds of sulphuric acid",
    pressure: "92 times Earth's",
    interior: "Probably an iron core and rocky mantle much like Earth's, but without plate tectonics or a magnetic field.",
    features: [
      { title: "A runaway greenhouse", text: "The hottest planet, though Mercury is closer to the Sun: its thick air keeps the heat in." },
      { title: "Volcanic plains", text: "Radar shows a surface shaped by volcanoes, and Maxwell Montes, mountains 11 km high." },
      { title: "Backwards spin", text: "On Venus the Sun would rise in the west, if you could see it through the clouds." },
    ],
    missions: [
      { name: "Venera 7", when: "1970", what: "The first spacecraft to land on another planet and send back data." },
      { name: "Magellan", when: "1990–1994", what: "Mapped 98% of the surface by radar." },
      { name: "Akatsuki", when: "2015–2024", what: "JAXA's orbiter studying Venus's weather." },
    ],
    swatch: ["#f1dfae", "#a9763e"],
  },
  Earth: {
    tagline: "The only world known to carry life",
    overview: [
      "Earth is the largest of the rocky planets and the only place we know of with liquid water on the surface and life. Oceans cover 71% of it, and an atmosphere of nitrogen and oxygen keeps it at a mean of about 15 °C.",
      "Its surface is broken into tectonic plates that move a few centimetres a year, carried on the slowly flowing mantle beneath. Where they meet, they build mountains, open oceans, and set off earthquakes and volcanoes.",
      "A molten iron outer core generates a magnetic field that shields the surface from the solar wind. Our one large Moon steadies Earth's tilt and drives the tides.",
    ],
    massEarths: 1,
    density: 5.51,
    gravity: 9.8,
    escape: 11.2,
    orbitMkm: 149.6,
    tempRange: [-89, 57],
    atmosphere: "Nitrogen 78%, oxygen 21%, argon 0.9%, carbon dioxide 0.04%",
    pressure: "1 bar at sea level",
    interior: "A solid iron inner core, a liquid outer core, a rocky mantle and a thin crust split into plates.",
    features: [
      { title: "Tectonic plates", text: "About fifteen major plates and dozens of small ones. Turn on PLATES to see their boundaries, with subduction zones, where one plate dives under another, marked in orange.", look: "plates" },
      { title: "City lights", text: "On the night side, the lights of cities trace where people live, from NASA's night-time imagery." },
      { title: "The blue marble", text: "Scattered sunlight makes the sky and the thin rim of atmosphere glow blue from space." },
    ],
    missions: [
      { name: "Apollo 8", when: "1968", what: "The first people to see the whole Earth from space, and the photograph Earthrise." },
      { name: "Apollo 17", when: "1972", what: "The Blue Marble photograph of the full, sunlit Earth." },
      { name: "The ISS", when: "1998–today", what: "People have lived continuously in orbit since November 2000." },
    ],
    swatch: ["#8fc4f2", "#1c4f8a"],
  },
  Mars: {
    tagline: "A cold desert that was once wet",
    overview: [
      "Mars is half Earth's size, with a thin carbon-dioxide atmosphere and a surface of rust-red dust. Average temperatures sit around −65 °C, but on a summer day at the equator the ground can reach 20 °C.",
      "Dry river valleys, lake beds and minerals that form only in water show that Mars was once warmer and wetter. Today its water is locked in polar ice caps and underground.",
      "It holds the largest volcano and one of the deepest canyons known, and more spacecraft have explored it than any planet besides Earth.",
    ],
    massEarths: 0.107,
    density: 3.93,
    gravity: 3.7,
    escape: 5.0,
    orbitMkm: 228.0,
    tempRange: [-140, 20],
    atmosphere: "Carbon dioxide 95%, nitrogen 2.8%, argon 2%",
    pressure: "Under 1% of Earth's",
    interior: "An iron-sulphur core, partly liquid, under a rocky mantle and crust, as InSight's seismometer found.",
    features: [
      { title: "Olympus Mons", text: "A shield volcano about 22 km high, two and a half times Everest, and about 600 km across." },
      { title: "Valles Marineris", text: "A canyon system over 4,000 km long and up to 7 km deep: it would stretch across the United States." },
      { title: "Polar caps", text: "Caps of water ice that grow a winter coat of frozen carbon dioxide each year." },
    ],
    missions: [
      { name: "Viking 1 and 2", when: "1976", what: "The first successful landers, which also searched the soil for life." },
      { name: "Curiosity", when: "2012–today", what: "NASA's rover climbing Mount Sharp in Gale crater." },
      { name: "Perseverance", when: "2021–today", what: "Collecting rock samples in Jezero crater, an ancient lake bed; it carried the helicopter Ingenuity." },
    ],
    swatch: ["#e3a172", "#7d3a1d"],
  },
  Jupiter: {
    tagline: "King of the planets, wrapped in storms",
    overview: [
      "Jupiter is more than twice as massive as all the other planets put together. It is made mostly of hydrogen and helium, like a star, and has no solid surface: its clouds of ammonia and water simply thicken into a hot, dense interior.",
      "Its stripes are bands of cloud blown by winds that reverse direction from one band to the next, at up to 500 km/h. Jupiter spins faster than any other planet, once in under ten hours, which flattens it noticeably at the poles.",
      "NASA's Juno, in orbit since 2016, has shown that its poles look nothing like the stripes: they are crowded with clusters of giant cyclones.",
    ],
    massEarths: 317.8,
    density: 1.33,
    gravity: 23.1,
    escape: 59.5,
    orbitMkm: 778.5,
    atmosphere: "Hydrogen about 90%, helium about 10%, traces of methane, ammonia and water",
    pressure: "No surface; the 1-bar level is used as its top",
    interior: "Hydrogen squeezed into a liquid metal deep down, around a large, diffuse core of heavier elements.",
    features: [
      { title: "The Great Red Spot", text: "A storm wider than Earth that has blown for at least 190 years, perhaps since the 1660s. It has been shrinking for a century and is now about 1.3 Earths wide.", look: "storm" },
      { title: "Polar cyclones", text: "Juno found eight cyclones arranged in an octagon around one at the north pole, and five, sometimes six, around one at the south pole, each thousands of kilometres across.", look: "north" },
      { title: "Faint rings", text: "Thin, dusty rings, found by Voyager 1 in 1979, made of dust knocked off its small inner moons." },
    ],
    missions: [
      { name: "Voyager 1 and 2", when: "1979", what: "Discovered Jupiter's rings and Io's volcanoes." },
      { name: "Galileo", when: "1995–2003", what: "The first orbiter, which dropped a probe into the atmosphere." },
      { name: "Juno", when: "2016–today", what: "Flying over the poles to map the interior and the polar cyclones." },
      { name: "Europa Clipper and JUICE", when: "Arriving 2030–2031", what: "NASA and ESA missions to the icy moons and their hidden oceans." },
    ],
    swatch: ["#e9d2b0", "#9a6a46"],
  },
  Saturn: {
    tagline: "The ringed giant, lighter than water",
    overview: [
      "Saturn is the second-largest planet, a gas giant of hydrogen and helium so light that, on average, it is less dense than water. It spins once in under eleven hours, which makes it the most flattened planet.",
      "Its rings are made of countless pieces of water ice, from grains of dust to boulders the size of houses. They stretch about 280,000 km across but are mostly no thicker than a building is tall.",
      "With 274 known moons, more than any other planet, Saturn is a small system of its own, including Titan, the only moon with a thick atmosphere.",
    ],
    massEarths: 95.2,
    density: 0.69,
    gravity: 9.0,
    escape: 35.5,
    orbitMkm: 1432.0,
    atmosphere: "Hydrogen about 96%, helium about 3%, traces of methane and ammonia",
    pressure: "No surface; the 1-bar level is used as its top",
    interior: "Metallic hydrogen around a dense, fuzzy core of rock and ice.",
    features: [
      { title: "The north polar hexagon", text: "A six-sided jet stream around the north pole, each side about 13,800 km long, wider than Earth. Voyager found it in 1981 and Cassini watched it through a whole Saturn season; nothing like it is seen anywhere else.", look: "north" },
      { title: "The rings", text: "Seven main rings, named A to G in order of discovery. The 4,700 km wide Cassini Division separates the bright A and B rings. Saturn's shadow falls across them, and they cast shadows on the planet.", look: "rings" },
      { title: "The south polar storm", text: "A hurricane-like vortex sits right on the south pole, with an eye about 8,000 km across ringed by towering clouds.", look: "south" },
    ],
    missions: [
      { name: "Pioneer 11", when: "1979", what: "The first flyby." },
      { name: "Voyager 1 and 2", when: "1980–1981", what: "Revealed the structure of the rings and found the hexagon." },
      { name: "Cassini–Huygens", when: "2004–2017", what: "Thirteen years in orbit; the Huygens probe landed on Titan in 2005. Cassini ended by diving into Saturn." },
      { name: "Dragonfly", when: "Launching 2028", what: "A NASA drone-copter that will fly between sites on Titan." },
    ],
    swatch: ["#efdcb1", "#a58658"],
  },
  Uranus: {
    tagline: "The ice giant knocked onto its side",
    overview: [
      "Uranus is an ice giant: under its hydrogen and helium air lies a deep mantle of water, ammonia and methane ices. Methane in the atmosphere absorbs red light, giving the planet its pale cyan colour.",
      "It is tipped over by 98°, so it rolls round the Sun on its side. Each pole has about 42 years of continuous daylight followed by 42 years of night; a giant collision long ago is the likely cause.",
      "It was the first planet found with a telescope, by William Herschel in 1781. Only Voyager 2 has been there, in 1986.",
    ],
    massEarths: 14.5,
    density: 1.27,
    gravity: 8.7,
    escape: 21.3,
    orbitMkm: 2867.0,
    atmosphere: "Hydrogen 83%, helium 15%, methane 2%",
    pressure: "No surface; the 1-bar level is used as its top",
    interior: "A small rocky core under a thick, hot mantle of water, ammonia and methane ices.",
    features: [
      { title: "Sideways seasons", text: "Its 98° tilt gives it the most extreme seasons of any planet." },
      { title: "Thin dark rings", text: "Thirteen narrow rings of dark material, found in 1977 when they passed in front of a star." },
      { title: "The coldest air", text: "Its atmosphere reaches −224 °C, the coldest of any planet, though Neptune is farther out." },
    ],
    missions: [{ name: "Voyager 2", when: "1986", what: "The only visit: found ten new moons and two new rings." }],
    swatch: ["#c9f0f2", "#5aa7b8"],
  },
  Neptune: {
    tagline: "The windy blue world at the edge",
    overview: [
      "Neptune is the farthest planet, 30 times farther from the Sun than Earth, and takes 165 years to go round once. It completed its first full orbit since its discovery in 2011.",
      "Like Uranus it is an ice giant, but a deeper blue, and far more active: its winds are the fastest measured in the Solar System, over 2,000 km/h, driven by heat from inside the planet.",
      "It was the first planet found by mathematics: Urbain Le Verrier predicted where it must be from the way it tugged on Uranus, and Johann Galle saw it there in 1846.",
    ],
    massEarths: 17.1,
    density: 1.64,
    gravity: 11.0,
    escape: 23.5,
    orbitMkm: 4515.0,
    atmosphere: "Hydrogen 80%, helium 19%, methane 1.5%",
    pressure: "No surface; the 1-bar level is used as its top",
    interior: "A rocky core under a hot mantle of water, ammonia and methane ices.",
    features: [
      { title: "Supersonic winds", text: "Clouds race round the planet at over 2,000 km/h, faster than the speed of sound there." },
      { title: "Dark spots", text: "Voyager 2 saw a Great Dark Spot the size of Earth in 1989; by 1994 it had gone. Others have come and gone since." },
      { title: "Triton", text: "Its largest moon orbits backwards and has nitrogen geysers: probably a captured world from the Kuiper Belt." },
    ],
    missions: [{ name: "Voyager 2", when: "1989", what: "The only visit: discovered six moons, the rings, and the Great Dark Spot." }],
    swatch: ["#7fa6ff", "#203a9a"],
  },
  Pluto: {
    tagline: "A dwarf planet with a frozen heart",
    overview: [
      "Pluto was counted as the ninth planet from its discovery by Clyde Tombaugh in 1930 until 2006, when astronomers made it the first of a new class: dwarf planets. It is smaller than our Moon and lives in the Kuiper Belt, a ring of icy bodies beyond Neptune.",
      "New Horizons flew past in 2015 and found a world far more alive than expected: mountains of water ice, glaciers of nitrogen, a thin blue haze, and a surface young enough that something is still reshaping it.",
      "Its orbit is tilted and stretched, so for 20 years in every 248 it comes closer to the Sun than Neptune.",
    ],
    massEarths: 0.0022,
    density: 1.85,
    gravity: 0.62,
    escape: 1.2,
    orbitMkm: 5906.4,
    atmosphere: "A thin haze of nitrogen, methane and carbon monoxide",
    pressure: "About 1/100,000 of Earth's",
    interior: "A rocky core inside a thick shell of water ice, perhaps over an ocean.",
    features: [
      { title: "The heart", text: "Tombaugh Regio, a bright heart-shaped region; its western lobe, Sputnik Planitia, is a 1,000 km plain of slowly churning nitrogen ice." },
      { title: "Blue skies", text: "Its haze scatters sunlight blue, as Earth's sky does." },
      { title: "A double world", text: "Charon is half Pluto's size; the two circle a point in space between them, each always showing the other the same face." },
    ],
    missions: [{ name: "New Horizons", when: "2015", what: "The only visit: a flyby at 12,500 km, then on to Arrokoth in 2019." }],
    swatch: ["#e7d3b9", "#8a6a52"],
  },
};
