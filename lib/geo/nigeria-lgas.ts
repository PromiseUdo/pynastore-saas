/*
 * lib/geo/nigeria-lgas.ts
 *
 * Nigeria's 774 Local Government Areas (768 LGAs and the FCT's 6 area
 * councils), by state — the list delivery zones are built from and shoppers
 * pick their area from (ROADMAP 25.1), so the two always name a place the
 * same way. Client-safe: data and pure functions only.
 *
 * Source: Wikipedia, "Local government areas of Nigeria" (fetched
 * 2026-11-20), checked against each state's official LGA count; four states
 * the page gets wrong were corrected to the official list — Ogun (two towns
 * that aren't LGAs removed), Oyo (Kajola and Surulere added), Sokoto (a
 * duplicate removed; Kebbe, Shagari and Yabo added) and the FCT (its six
 * area councils only).
 *
 * `KNOWN_AREAS` are well-known towns and neighbourhoods people say instead
 * of their LGA ("Lekki", "Festac", "Wuse"), for searching the list and for
 * reading addresses and zones typed before the list existed. Only places
 * that sit clearly in one LGA are listed; an ambiguous one is left out
 * rather than guessed.
 */
import { normalizePlace, type NigerianState } from './nigeria';

export const NIGERIAN_LGAS: Record<NigerianState, readonly string[]> = {
  "Abia": ["Aba North", "Aba South", "Arochukwu", "Bende", "Ikwuano", "Isiala Ngwa North", "Isiala Ngwa South", "Isuikwuato", "Obi Ngwa", "Ohafia", "Osisioma Ngwa", "Ugwunagbo", "Ukwa East", "Ukwa West", "Umu Nneochi", "Umuahia North", "Umuahia South"],
  "Adamawa": ["Demsa", "Fufure", "Ganye", "Girei", "Gombi", "Guyuk", "Hong", "Jada", "Lamurde", "Madagali", "Maiha", "Mayo Belwa", "Michika", "Mubi North", "Mubi South", "Numan", "Shelleng", "Song", "Toungo", "Yola North", "Yola South"],
  "Akwa Ibom": ["Abak", "Eastern Obolo", "Eket", "Esit Eket", "Essien Udim", "Etim Ekpo", "Etinan", "Ibeno", "Ibesikpo Asutan", "Ibiono-Ibom", "Ika", "Ikono", "Ikot Abasi", "Ikot Ekpene", "Ini", "Itu", "Mbo", "Mkpat-Enin", "Nsit-Atai", "Nsit-Ibom", "Nsit-Ubium", "Obot Akara", "Okobo", "Onna", "Oron", "Oruk Anam", "Udung-Uko", "Ukanafun", "Uruan", "Urue-Offong/Oruko", "Uyo"],
  "Anambra": ["Aguata", "Anambra East", "Anambra West", "Anaocha", "Awka North", "Awka South", "Ayamelum", "Dunukofia", "Ekwusigo", "Idemili North", "Idemili South", "Ihiala", "Njikoka", "Nnewi North", "Nnewi South", "Ogbaru", "Onitsha North", "Onitsha South", "Orumba North", "Orumba South", "Oyi"],
  "Bauchi": ["Alkaleri", "Bauchi", "Bogoro", "Dambam", "Darazo", "Dass", "Gamawa", "Ganjuwa", "Giade", "Itas/Gadau", "Jama'are", "Katagum", "Kirfi", "Misau", "Ningi", "Shira", "Tafawa Balewa", "Toro", "Warji", "Zaki"],
  "Bayelsa": ["Brass", "Ekeremor", "Kolokuma/Opokuma", "Nembe", "Ogbia", "Sagbama", "Southern Ijaw", "Yenagoa"],
  "Benue": ["Ado", "Agatu", "Apa", "Buruku", "Gboko", "Guma", "Gwer East", "Gwer West", "Katsina-Ala", "Konshisha", "Kwande", "Logo", "Makurdi", "Obi", "Ogbadibo", "Ohimini", "Oju", "Okpokwu", "Oturkpo", "Tarka", "Ukum", "Ushongo", "Vandeikya"],
  "Borno": ["Abadam", "Askira/Uba", "Bama", "Bayo", "Biu", "Chibok", "Damboa", "Dikwa", "Gubio", "Guzamala", "Gwoza", "Hawul", "Jere", "Kaga", "Kala/Balge", "Konduga", "Kukawa", "Kwaya Kusar", "Mafa", "Magumeri", "Maiduguri", "Marte", "Mobbar", "Monguno", "Ngala", "Nganzai", "Shani"],
  "Cross River": ["Abi", "Akamkpa", "Akpabuyo", "Bakassi", "Bekwarra", "Biase", "Boki", "Calabar Municipal", "Calabar South", "Etung", "Ikom", "Obanliku", "Obubra", "Obudu", "Odukpani", "Ogoja", "Yakurr", "Yala"],
  "Delta": ["Aniocha North", "Aniocha South", "Bomadi", "Burutu", "Ethiope East", "Ethiope West", "Ika North East", "Ika South", "Isoko North", "Isoko South", "Ndokwa East", "Ndokwa West", "Okpe", "Oshimili North", "Oshimili South", "Patani", "Sapele", "Udu", "Ughelli North", "Ughelli South", "Ukwuani", "Uvwie", "Warri North", "Warri South", "Warri South West"],
  "Ebonyi": ["Abakaliki", "Afikpo", "Ebonyi", "Edda", "Ezza North", "Ezza South", "Ikwo", "Ishielu", "Ivo", "Izzi", "Ohaozara", "Ohaukwu", "Onicha"],
  "Edo": ["Akoko-Edo", "Egor", "Esan Central", "Esan North-East", "Esan South-East", "Esan West", "Etsako Central", "Etsako East", "Etsako West", "Igueben", "Ikpoba Okha", "Oredo", "Orhionmwon", "Ovia North-East", "Ovia South-West", "Owan East", "Owan West", "Uhunmwonde"],
  "Ekiti": ["Ado Ekiti", "Efon", "Ekiti East", "Ekiti South-West", "Ekiti West", "Emure", "Gbonyin", "Ido Osi", "Ijero", "Ikere", "Ikole", "Ilejemeje", "Irepodun/Ifelodun", "Ise/Orun", "Moba", "Oye"],
  "Enugu": ["Aninri", "Awgu", "Enugu East", "Enugu North", "Enugu South", "Ezeagu", "Igbo Etiti", "Igbo Eze North", "Igbo Eze South", "Isi Uzo", "Nkanu East", "Nkanu West", "Nsukka", "Oji River", "Udenu", "Udi", "Uzo-Uwani"],
  "Federal Capital Territory": ["Abaji", "Abuja Municipal Area Council", "Bwari", "Gwagwalada", "Kuje", "Kwali"],
  "Gombe": ["Akko", "Balanga", "Billiri", "Dukku", "Funakaye", "Gombe", "Kaltungo", "Kwami", "Nafada", "Shongom", "Yamaltu/Deba"],
  "Imo": ["Aboh Mbaise", "Ahiazu Mbaise", "Ehime Mbano", "Ezinihitte", "Ideato North", "Ideato South", "Ihitte/Uboma", "Ikeduru", "Isiala Mbano", "Isu", "Mbaitoli", "Ngor Okpala", "Njaba", "Nkwerre", "Nwangele", "Obowo", "Oguta", "Ohaji/Egbema", "Okigwe", "Onuimo", "Orlu", "Orsu", "Oru East", "Oru West", "Owerri Municipal", "Owerri North", "Owerri West"],
  "Jigawa": ["Auyo", "Babura", "Birnin Kudu", "Birniwa", "Buji", "Dutse", "Gagarawa", "Garki", "Gumel", "Guri", "Gwaram", "Gwiwa", "Hadejia", "Jahun", "Kafin Hausa", "Kaugama", "Kazaure", "Kiri Kasama", "Kiyawa", "Maigatari", "Malam Madori", "Miga", "Ringim", "Roni", "Sule Tankarkar", "Taura", "Yankwashi"],
  "Kaduna": ["Birnin Gwari", "Chikun", "Giwa", "Igabi", "Ikara", "Jaba", "Jema'a", "Kachia", "Kaduna North", "Kaduna South", "Kagarko", "Kajuru", "Kaura", "Kauru", "Kubau", "Kudan", "Lere", "Makarfi", "Sabon Gari", "Sanga", "Soba", "Zangon Kataf", "Zaria"],
  "Kano": ["Ajingi", "Albasu", "Bagwai", "Bebeji", "Bichi", "Bunkure", "Dala", "Dambatta", "Dawakin Kudu", "Dawakin Tofa", "Doguwa", "Fagge", "Gabasawa", "Garko", "Garun Mallam", "Gaya", "Gezawa", "Ghari", "Gwale", "Gwarzo", "Kabo", "Kano Municipal", "Karaye", "Kibiya", "Kiru", "Kumbotso", "Kura", "Madobi", "Makoda", "Minjibir", "Nasarawa", "Rano", "Rimin Gado", "Rogo", "Shanono", "Sumaila", "Takai", "Tarauni", "Tofa", "Tsanyawa", "Tudun Wada", "Ungogo", "Warawa", "Wudil"],
  "Katsina": ["Bakori", "Batagarawa", "Batsari", "Baure", "Bindawa", "Charanchi", "Dan Musa", "Dandume", "Danja", "Daura", "Dutsi", "Dutsin Ma", "Faskari", "Funtua", "Ingawa", "Jibia", "Kafur", "Kaita", "Kankara", "Kankia", "Katsina", "Kurfi", "Kusada", "Mai'Adua", "Malumfashi", "Mani", "Mashi", "Matazu", "Musawa", "Rimi", "Sabuwa", "Safana", "Sandamu", "Zango"],
  "Kebbi": ["Aleiro", "Arewa-Dandi", "Argungu", "Augie", "Bagudo", "Birnin Kebbi", "Bunza", "Dandi", "Fakai", "Gwandu", "Jega", "Kalgo", "Koko/Besse", "Maiyama", "Ngaski", "Sakaba", "Shanga", "Suru", "Wasagu/Danko", "Yauri", "Zuru"],
  "Kogi": ["Adavi", "Ajaokuta", "Ankpa", "Bassa", "Dekina", "Ibaji", "Idah", "Igalamela-Odolu", "Ijumu", "Kabba/Bunu", "Kogi", "Lokoja", "Mopa-Muro", "Ofu", "Ogori/Magongo", "Okehi", "Okene", "Olamaboro", "Omala", "Yagba East", "Yagba West"],
  "Kwara": ["Asa", "Baruten", "Edu", "Ekiti", "Ifelodun", "Ilorin East", "Ilorin South", "Ilorin West", "Irepodun", "Isin", "Kaiama", "Moro", "Offa", "Oke Ero", "Oyun", "Pategi"],
  "Lagos": ["Agege", "Ajeromi-Ifelodun", "Alimosho", "Amuwo-Odofin", "Apapa", "Badagry", "Epe", "Eti Osa", "Ibeju-Lekki", "Ifako-Ijaiye", "Ikeja", "Ikorodu", "Kosofe", "Lagos Island", "Lagos Mainland", "Mushin", "Ojo", "Oshodi-Isolo", "Shomolu", "Surulere"],
  "Nasarawa": ["Akwanga", "Awe", "Doma", "Karu", "keana", "Keffi", "Kokona", "Lafia", "Nasarawa", "Nasarawa Eggon", "Obi", "Toto", "Wamba"],
  "Niger": ["Agaie", "Agwara", "Bida", "Borgu", "Bosso", "Chanchaga", "Edati", "Gbako", "Gurara", "Katcha", "Kontagora", "Lapai", "Lavun", "Magama", "Mariga", "Mashegu", "Mokwa", "Munya", "Paikoro", "Rafi", "Rijau", "Shiroro", "Suleja", "Tafa", "Wushishi"],
  "Ogun": ["Abeokuta North", "Abeokuta South", "Ado-Odo/Ota", "Ewekoro", "Ifo", "Ijebu East", "Ijebu North", "Ijebu North East", "Ijebu Ode", "Ikenne", "Imeko Afon", "Ipokia", "Obafemi Owode", "Odeda", "Odogbolu", "Ogun Waterside", "Remo North", "Shagamu", "Yewa North", "Yewa South"],
  "Ondo": ["Akoko North-East", "Akoko North-West", "Akoko South-East", "Akoko South-West", "Akure North", "Akure South", "Ese Odo", "Idanre", "Ifedore", "Ilaje", "Ile-Oluji", "Irele", "Odigbo", "Okitipupa", "Ondo East", "Ondo West", "Ose", "Owo"],
  "Osun": ["Aiyedaade", "Aiyedire", "Atakunmosa East", "Atakunmosa West", "Boluwaduro", "Boripe", "Ede North", "Ede South", "Egbedore", "Ejigbo", "Ife Central", "Ife East", "Ife North", "Ife South", "Ifedayo", "Ifelodun", "Ila", "Ilesa East", "Ilesa West", "Irepodun", "Irewole", "Isokan", "Iwo", "Obokun", "Odo-Otin", "Ola-Oluwa", "Olorunda", "Oriade", "Orolu", "Osogbo"],
  "Oyo": ["Afijio", "Akinyele", "Atiba", "Atisbo", "Egbeda", "Ibadan North", "Ibadan North-East", "Ibadan North-West", "Ibadan South-East", "Ibadan South-West", "Ibarapa Central", "Ibarapa East", "Ibarapa North", "Ido", "Irepo", "Iseyin", "Itesiwaju", "Iwajowa", "Kajola", "Lagelu", "Ogbomosho North", "Ogbomosho South", "Ogo Oluwa", "Olorunsogo", "Oluyole", "Ona Ara", "Orelope", "Orire", "Oyo East", "Oyo West", "Saki East", "Saki West", "Surulere"],
  "Plateau": ["Barkin Ladi", "Bassa", "Bokkos", "Jos East", "Jos North", "Jos South", "Kanam", "Kanke", "Langtang North", "Langtang South", "Mangu", "Mikang", "Pankshin", "Qua'an-Pan", "Riyom", "Shendam", "Wase"],
  "Rivers": ["Abua-Odual", "Ahoada East", "Ahoada West", "Akuku Toru", "Andoni", "Asari Toru", "Bonny", "Degema", "Eleme", "Emohua", "Etche", "Gokana", "Ikwerre", "Khana", "Obio-Akpor", "Ogba-Egbema-Ndoni", "Ogu-Bolo", "Okirika", "Omuma", "Opobo-Nkoro", "Oyigbo", "Port Harcourt", "Tai"],
  "Sokoto": ["Binji", "Bodinga", "Dange Shuni", "Gada", "Goronyo", "Gudu", "Gwadabawa", "Illela", "Isah", "Kebbe", "Kware", "Rabah", "Sabon Birni", "Shagari", "Silame", "Sokoto North", "Sokoto South", "Tambuwal", "Tangaza", "Tureta", "Wamakko", "Wurno", "Yabo"],
  "Taraba": ["Ardo Kola", "Bali", "Donga", "Gashaka", "Gassol", "Ibi", "Jalingo", "Karim Lamido", "Kurmi", "Lau", "Sardauna", "Takum", "Ussa", "Wukari", "Yorro", "Zing"],
  "Yobe": ["Bade", "Bursali", "Damaturu", "Fika", "Fune", "Geidam", "Gujba", "Gulani", "Jakusko", "Karasuwa", "Machina", "Nangere", "Nguru", "Potiskum", "Tarmuwa", "Yunusari", "Yusufari"],
  "Zamfara": ["Anka", "Bakuka", "Birnin Magaji/Kiyaw", "Bukkuyum", "Bungudu", "Gummi", "Gusau", "Kaura-Namoda", "Maradun", "Maru", "Shinkafi", "Talata-Mafara", "Tsafe", "Zurmi"],
};

/** Well-known places inside one LGA, by state: place → LGA (as spelled in NIGERIAN_LGAS). */
export const KNOWN_AREAS: Partial<Record<NigerianState, Record<string, string>>> = {
  Lagos: {
    Lekki: 'Eti Osa', 'Lekki Phase 1': 'Eti Osa', Ajah: 'Eti Osa', 'Victoria Island': 'Eti Osa', VI: 'Eti Osa',
    Ikoyi: 'Eti Osa', Oniru: 'Eti Osa', Chevron: 'Eti Osa', Osapa: 'Eti Osa', Ikota: 'Eti Osa', Sangotedo: 'Eti Osa',
    Awoyaya: 'Ibeju-Lekki', Lakowe: 'Ibeju-Lekki', Eleko: 'Ibeju-Lekki', Abijo: 'Ibeju-Lekki',
    Yaba: 'Lagos Mainland', 'Ebute Metta': 'Lagos Mainland', Akoka: 'Lagos Mainland', Oyingbo: 'Lagos Mainland',
    Obalende: 'Lagos Island', Idumota: 'Lagos Island', Marina: 'Lagos Island', 'Isale Eko': 'Lagos Island',
    'Bode Thomas': 'Surulere', Ojuelegba: 'Surulere', Aguda: 'Surulere', Ijesha: 'Surulere', Kilo: 'Surulere',
    Masha: 'Surulere', Itire: 'Surulere', 'Adeniran Ogunsanya': 'Surulere',
    Festac: 'Amuwo-Odofin', 'Festac Town': 'Amuwo-Odofin', 'Mile 2': 'Amuwo-Odofin', 'Satellite Town': 'Amuwo-Odofin',
    Agboju: 'Amuwo-Odofin', 'Abule Ado': 'Amuwo-Odofin',
    Alaba: 'Ojo', Iba: 'Ojo', Okokomaiko: 'Ojo',
    Ajegunle: 'Ajeromi-Ifelodun',
    Ikotun: 'Alimosho', Egbeda: 'Alimosho', Idimu: 'Alimosho', Igando: 'Alimosho', Ipaja: 'Alimosho', Ayobo: 'Alimosho',
    Akowonjo: 'Alimosho', 'Gowon Estate': 'Alimosho',
    Allen: 'Ikeja', Opebi: 'Ikeja', Alausa: 'Ikeja', Oregun: 'Ikeja', Ogba: 'Ikeja', Agidingbi: 'Ikeja',
    Gbagada: 'Kosofe', Ketu: 'Kosofe', Ojota: 'Kosofe', 'Mile 12': 'Kosofe', Ogudu: 'Kosofe', Magodo: 'Kosofe',
    Alapere: 'Kosofe',
    Bariga: 'Shomolu', Somolu: 'Shomolu', Palmgrove: 'Shomolu', Pedro: 'Shomolu',
    'Idi Araba': 'Mushin', 'Papa Ajao': 'Mushin',
    Oshodi: 'Oshodi-Isolo', Isolo: 'Oshodi-Isolo', Ejigbo: 'Oshodi-Isolo', Okota: 'Oshodi-Isolo', 'Ago Palace': 'Oshodi-Isolo',
    Ijede: 'Ikorodu', Igbogbo: 'Ikorodu',
    Seme: 'Badagry',
  },
  'Federal Capital Territory': {
    Abuja: 'Abuja Municipal Area Council', AMAC: 'Abuja Municipal Area Council', Municipal: 'Abuja Municipal Area Council',
    Garki: 'Abuja Municipal Area Council', Wuse: 'Abuja Municipal Area Council', 'Wuse 2': 'Abuja Municipal Area Council',
    Maitama: 'Abuja Municipal Area Council', Asokoro: 'Abuja Municipal Area Council', Jabi: 'Abuja Municipal Area Council',
    Utako: 'Abuja Municipal Area Council', Wuye: 'Abuja Municipal Area Council', Gwarinpa: 'Abuja Municipal Area Council',
    'Life Camp': 'Abuja Municipal Area Council', Kado: 'Abuja Municipal Area Council', Katampe: 'Abuja Municipal Area Council',
    Guzape: 'Abuja Municipal Area Council', Apo: 'Abuja Municipal Area Council', Lokogoma: 'Abuja Municipal Area Council',
    Lugbe: 'Abuja Municipal Area Council', Durumi: 'Abuja Municipal Area Council', Gudu: 'Abuja Municipal Area Council',
    Mabushi: 'Abuja Municipal Area Council', Jahi: 'Abuja Municipal Area Council', Nyanya: 'Abuja Municipal Area Council',
    Karshi: 'Abuja Municipal Area Council',
    Kubwa: 'Bwari', Dutse: 'Bwari', Ushafa: 'Bwari', Dawaki: 'Bwari',
  },
  Rivers: {
    'Port-Harcourt': 'Port Harcourt', PH: 'Port Harcourt', Diobu: 'Port Harcourt', 'D-Line': 'Port Harcourt', Borokiri: 'Port Harcourt',
    Rumuokoro: 'Obio-Akpor', Rumuola: 'Obio-Akpor', Rumuigbo: 'Obio-Akpor', Rumuodara: 'Obio-Akpor',
    Rumuokwuta: 'Obio-Akpor', 'Ada George': 'Obio-Akpor', Choba: 'Obio-Akpor', Elelenwo: 'Obio-Akpor', Woji: 'Obio-Akpor',
    Rumuomasi: 'Obio-Akpor',
    Onne: 'Eleme', Aleto: 'Eleme',
  },
  Edo: { 'Benin City': 'Oredo', Benin: 'Oredo' },
  Imo: { Owerri: 'Owerri Municipal' },
  Delta: { Asaba: 'Oshimili South', Warri: 'Warri South' },
  'Cross River': { Calabar: 'Calabar Municipal' },
  Anambra: { Awka: 'Awka South' },
  Ondo: { Akure: 'Akure South' },
  Ogun: { Sagamu: 'Shagamu', Ota: 'Ado-Odo/Ota' },
};

const keyFor = (value: string) => normalizePlace(value);

/** A state's LGAs, alphabetical. Empty for something that isn't a state. */
export function lgasOf(state: string): readonly string[] {
  return (NIGERIAN_LGAS as Record<string, readonly string[]>)[state] ?? [];
}

/**
 * The LGA a place name means, in this state — an LGA name however it's
 * typed ("eti-osa", "Eti Osa LGA") or a well-known place in one ("Lekki").
 * Null when it's neither: an unknown name is never guessed at.
 */
export function findLga(state: string, place: string): string | null {
  const key = keyFor(place);
  if (!key) return null;
  const lga = lgasOf(state).find((name) => keyFor(name) === key);
  if (lga) return lga;
  const areas = (KNOWN_AREAS as Record<string, Record<string, string>>)[state];
  if (!areas) return null;
  for (const [area, area_lga] of Object.entries(areas)) if (keyFor(area) === key) return area_lga;
  return null;
}

/** The well-known places in an LGA — what a search for "Lekki" finds "Eti Osa" by. */
export function knownAreasIn(state: string, lga: string): string[] {
  const areas = (KNOWN_AREAS as Record<string, Record<string, string>>)[state];
  return areas ? Object.keys(areas).filter((area) => areas[area] === lga) : [];
}

/**
 * A state's LGAs as picker options: the LGA is the value; the label adds a
 * few well-known places in it ("Eti Osa (Lekki, Ajah, Victoria Island)") so
 * a shopper who knows their area, not their LGA, still finds it.
 */
export function lgaOptions(state: string): { value: string; label: string }[] {
  return lgasOf(state).map((lga) => {
    const areas = knownAreasIn(state, lga).slice(0, 3);
    return { value: lga, label: areas.length ? `${lga} (${areas.join(', ')})` : lga };
  });
}
