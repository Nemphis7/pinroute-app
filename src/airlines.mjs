// Airline names for the two-letter IATA codes that fare sources send in place of a name (Aviasales's recent prices
// give "VJ", Amadeus gives a merchant code when its carrier list has no name, and other flight tools pass codes on).
// A curated list of airlines flying today, most of all the ones Pinroute's travellers meet between Europe, the Gulf
// and Asia. A code that isn't listed is kept as it is: a code is better than a wrong name. Codes are reused over the
// years, so the list names only the airline flying under each code now, and leaves out airlines that stopped flying.
const LIST = `
2L Helvetic Airways|2P PAL Express|2W World2fly|3O Air Arabia Maroc|3U Sichuan Airlines|4Y Discover Airlines|4Z Airlink
5J Cebu Pacific|6E IndiGo|7C Jeju Air|7G Star Flyer|8L Lucky Air|8M Myanmar Airways International|8U Afriqiyah Airways
9C Spring Airlines|A3 Aegean Airlines|AA American Airlines|AC Air Canada|AD Azul|AE Mandarin Airlines|AF Air France
AH Air Algérie|AI Air India|AK AirAsia|AL Malta Air|AM Aeroméxico|AR Aerolíneas Argentinas|AS Alaska Airlines
AT Royal Air Maroc|AV Avianca|AY Finnair|AZ ITA Airways|B6 JetBlue|B7 UNI Air|BA British Airways
BC Skymark Airlines|BG Biman Bangladesh Airlines|BI Royal Brunei Airlines|BJ Nouvelair|BR EVA Air|BS US-Bangla Airlines
BT airBaltic|BW Caribbean Airlines|BX Air Busan|BY TUI Airways|CA Air China|CI China Airlines|CM Copa Airlines
CX Cathay Pacific|CZ China Southern Airlines|D7 AirAsia X|D8 Norwegian|DD Nok Air|DE Condor|DG Cebgo
DL Delta Air Lines|DM Arajet|DS easyJet|DT TAAG Angola Airlines|DY Norwegian|E5 Air Arabia Egypt|EC easyJet
EI Aer Lingus|EK Emirates|EN Air Dolomiti|ET Ethiopian Airlines|EU Chengdu Airlines|EW Eurowings|EY Etihad Airways
F3 flyadeal|F8 Flair Airlines|F9 Frontier Airlines|FA FlySafair|FB Bulgaria Air|FD Thai AirAsia|FI Icelandair
FJ Fiji Airways|FM Shanghai Airlines|FR Ryanair|FZ flydubai|G3 Gol|G4 Allegiant Air|G9 Air Arabia|GA Garuda Indonesia
GF Gulf Air|GJ Loong Air|GK Jetstar Japan|GQ Sky Express|GS Tianjin Airlines|H2 Sky Airline|HA Hawaiian Airlines
HM Air Seychelles|HO Juneyao Air|HU Hainan Airlines|HV Transavia|HX Hong Kong Airlines|HY Uzbekistan Airways
I2 Iberia Express|IB Iberia|ID Batik Air|IJ Spring Japan|IR Iran Air|IT Tigerair Taiwan|IU Super Air Jet
IW Wings Air|IX Air India Express|IZ Arkia|J2 Azerbaijan Airlines|J9 Jazeera Airways|JA JetSMART
JD Beijing Capital Airlines|JL Japan Airlines|JQ Jetstar|JT Lion Air|JU Air Serbia|JX Starlux Airlines|K6 Cambodia Angkor Air
KB Druk Air|KC Air Astana|KE Korean Air|KL KLM|KM KM Malta Airlines|KN China United Airlines|KP ASKY Airlines
KQ Kenya Airways|KR Cambodia Airways|KU Kuwait Airways|LA LATAM Airlines|LG Luxair|LH Lufthansa|LJ Jin Air
LM Loganair|LO LOT Polish Airlines|LS Jet2|LX Swiss|LY El Al|ME Middle East Airlines|MF Xiamen Airlines
MH Malaysia Airlines|MK Air Mauritius|MM Peach|MS EgyptAir|MU China Eastern Airlines|NH ANA|NK Spirit Airlines
NO Neos|NQ Air Japan|NT Binter|NX Air Macau|NZ Air New Zealand|OA Olympic Air|OD Batik Air Malaysia
OR TUI fly Netherlands|OS Austrian Airlines|OU Croatia Airlines|OV SalamAir|OZ Asiana Airlines|P4 Air Peace
PC Pegasus Airlines|PD Porter Airlines|PG Bangkok Airways|PK Pakistan International Airlines|PN West Air
PR Philippine Airlines|PX Air Niugini|Q2 Maldivian|QF Qantas|QG Citilink|QH Bamboo Airways|QP Akasa Air
QR Qatar Airways|QV Lao Airlines|QZ Indonesia AirAsia|RJ Royal Jordanian|RK Ryanair UK|RO TAROM|RS Air Seoul
S7 S7 Airlines|SA South African Airways|SC Shandong Airlines|SG SpiceJet|SK SAS|SL Thai Lion Air|SM Air Cairo
SN Brussels Airlines|SQ Singapore Airlines|SU Aeroflot|SV Saudia|SY Sun Country Airlines|TB TUI fly Belgium
TC Air Tanzania|TG Thai Airways|TK Turkish Airlines|TN Air Tahiti Nui|TO Transavia France|TP TAP Air Portugal
TR Scoot|TS Air Transat|TU Tunisair|TV Tibet Airlines|TW T'way Air|U2 easyJet|UA United Airlines|UB Myanmar National Airlines
UL SriLankan Airlines|UO HK Express|UP Bahamasair|UX Air Europa|V7 Volotea|VA Virgin Australia|VB Viva Aerobus
VF AJet|VJ VietJet Air|VN Vietnam Airlines|VS Virgin Atlantic|VU Vietravel Airlines|VY Vueling|VZ Thai Vietjet Air
W2 FlexFlight|W6 Wizz Air|WB RwandAir|WF Widerøe|WK Edelweiss|WN Southwest Airlines|WS WestJet|WY Oman Air
X3 TUI fly|XJ Thai AirAsia X|XQ SunExpress|XR Corendon Airlines Europe|XY flynas|Y4 Volaris|YP Air Premia
YW Air Nostrum|Z2 Philippines AirAsia|ZE Eastar Jet|ZG Zipair|ZH Shenzhen Airlines
`;

export const AIRLINES = Object.freeze(Object.fromEntries(LIST.split(/[|\n]/).map((s) => s.trim()).filter(Boolean)
  .map((s) => [s.slice(0, 2), s.slice(3)])));

const CODE = /^[A-Z0-9]{2}$/;
const isCode = (s) => CODE.test(s) && /[A-Z]/.test(s);

// "VJ" → "VietJet Air"; "VJ, FD" → "VietJet Air, Thai AirAsia"; a name, or a code not listed, comes back as it was
export function airlineName(s) {
  const t = String(s ?? '').trim();
  if (!t) return t;
  const parts = t.split(/\s*[,/+&]\s*/);
  if (!parts.every((p) => isCode(p.toUpperCase()))) return t;
  return [...new Set(parts.map((p) => AIRLINES[p.toUpperCase()] || p.toUpperCase()))].join(', ');
}

// A flight line that starts with a flight number gets the airline's name in front:
// "QR 70, 21:10 FRA → 13:40 SGN" → "Qatar Airways QR 70, 21:10 FRA → 13:40 SGN". Lines that start with a name stay.
export function withAirlineName(line) {
  const t = String(line ?? '');
  const m = /^([A-Z0-9]{2})\s?(\d{1,4}[A-Z]?)\b/.exec(t);
  if (!m || !isCode(m[1]) || !AIRLINES[m[1]]) return t;
  return `${AIRLINES[m[1]]} ${t}`;
}

// A saved fare or ticket with names in place of codes, for the planner and for the model
export function namedFare(x) {
  if (!x || typeof x !== 'object') return x;
  return { ...x, airline: x.airline == null ? x.airline : airlineName(x.airline), out: x.out ? withAirlineName(x.out) : x.out, back: x.back ? withAirlineName(x.back) : x.back };
}
