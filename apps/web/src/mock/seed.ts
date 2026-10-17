import {
  type Business,
  type BusinessInput,
  type Client,
  type Family,
  type FamilyMember,
  type FamilyPerson,
  type Gender,
  type Marriage,
  makePartialDate,
  type ParentChild,
  type Person,
  type PersonBusiness,
  type User,
} from '@family-tree/shared';
import type { DemoDb } from './db.ts';

// Invented sample data for the client demo. Names are common Emirati names;
// no record describes a real person.

export const DEMO_CLIENT_ID = 'client-demo';

interface PersonSeed {
  id: string;
  en: string;
  ar: string;
  sex: 'M' | 'F';
  born: number;
  died?: number | null;
  family: string;
  surnameEn: string;
  surnameAr: string;
  extra?: Partial<Person>;
}

const FAMILY_NAMES: Record<string, { en: string; ar: string }> = {
  mansouri: { en: 'Al Mansouri', ar: 'المنصوري' },
  kaabi: { en: 'Al Kaabi', ar: 'الكعبي' },
  shamsi: { en: 'Al Shamsi', ar: 'الشامسي' },
  zaabi: { en: 'Al Zaabi', ar: 'الزعابي' },
  suwaidi: { en: 'Al Suwaidi', ar: 'السويدي' },
  mazrouei: { en: 'Al Mazrouei', ar: 'المزروعي' },
  hammadi: { en: 'Al Hammadi', ar: 'الحمادي' },
  ketbi: { en: 'Al Ketbi', ar: 'الكتبي' },
  marri: { en: 'Al Marri', ar: 'المري' },
  nuaimi: { en: 'Al Nuaimi', ar: 'النعيمي' },
};

const CITIES = [
  ['Abu Dhabi', 'أبوظبي'],
  ['Dubai', 'دبي'],
  ['Al Ain', 'العين'],
  ['Sharjah', 'الشارقة'],
  ['Ras Al Khaimah', 'رأس الخيمة'],
] as const;

function blankPerson(id: string): Person {
  return {
    id,
    clientId: DEMO_CLIENT_ID,
    firstName: '',
    middleName: null,
    lastName: null,
    maidenName: null,
    nameAr: null,
    nameEn: null,
    fatherName: null,
    grandfatherName: null,
    tribeName: null,
    kunya: null,
    laqab: null,
    gender: 'MALE',
    birth: null,
    death: null,
    isLiving: true,
    birthPlace: null,
    currentCity: null,
    photoUrl: null,
    phone: null,
    email: null,
    occupation: null,
    education: null,
    notes: null,
    marriedIntoNote: null,
    customFields: {},
    deletedAt: null,
  };
}

function toPerson(s: PersonSeed): Person {
  const fam = FAMILY_NAMES[s.family] ?? { en: s.surnameEn, ar: s.surnameAr };
  const gender: Gender = s.sex === 'M' ? 'MALE' : 'FEMALE';
  const city = CITIES[(s.born + s.en.length) % CITIES.length] ?? CITIES[0];
  const living = s.died == null && s.born > 1925;
  return {
    ...blankPerson(s.id),
    firstName: s.en,
    lastName: fam.en,
    nameEn: `${s.en} ${fam.en}`,
    nameAr: `${s.ar} ${fam.ar}`,
    tribeName: fam.en,
    gender,
    birth: makePartialDate(s.born),
    death: s.died ? makePartialDate(s.died) : null,
    isLiving: living,
    birthPlace: city[0],
    currentCity: living ? city[0] : null,
    phone:
      living && s.born < 2005
        ? `+971 50 ${100 + (s.born % 900)} ${String((s.born * 37 + s.en.length) % 10000).padStart(4, '0')}`
        : null,
    email: living && s.born < 2005 ? `${s.en.toLowerCase()}.${s.id}@example.ae` : null,
    ...s.extra,
  };
}

type Union = { a: string; b: string; year: number; kids: string[]; status?: Marriage['status']; ended?: number };

interface FamilySeed {
  family: Family;
  people: PersonSeed[];
  /** People who belong to this family by marriage (they are born into another family or none). */
  marriedIn: string[];
  unions: Union[];
  businesses: Array<{
    id: string;
    data: Partial<BusinessInput> & Pick<BusinessInput, 'name' | 'type'>;
    owners: Array<[string, PersonBusiness['role']]>;
  }>;
}

const P = (
  id: string,
  en: string,
  ar: string,
  sex: 'M' | 'F',
  born: number,
  died: number | null,
  family: string,
  extra?: Partial<Person>,
): PersonSeed => ({ id, en, ar, sex, born, died, family, surnameEn: '', surnameAr: '', ...(extra ? { extra } : {}) });

function familyRecord(id: string, name: string, nameAr: string, color: string, extra: Partial<Family>): Family {
  return {
    id,
    clientId: DEMO_CLIENT_ID,
    name,
    nameAr,
    surname: name,
    nativePlace: null,
    description: null,
    coverUrl: null,
    color,
    archivedAt: null,
    ...extra,
  };
}

const MANSOURI: FamilySeed = {
  family: familyRecord('fam-mansouri', 'Al Mansouri Family', 'عائلة المنصوري', '#0f6b63', {
    surname: 'Al Mansouri',
    nativePlace: 'Abu Dhabi',
    description:
      'Pearl merchants from Abu Dhabi island who moved into trading and logistics. Five generations from Khalid bin Rashid.',
  }),
  people: [
    P('k1', 'Khalid', 'خالد', 'M', 1905, 1978, 'mansouri', {
      occupation: 'Pearl merchant',
      laqab: 'Al Tawash',
      kunya: 'Abu Ahmed',
      notes: 'Ran pearling boats from Abu Dhabi until the 1950s, then opened the family’s first shop in the souq.',
    }),
    P('a1', 'Ahmed', 'أحمد', 'M', 1930, 2005, 'mansouri', { occupation: 'Merchant', kunya: 'Abu Rashid' }),
    P('m1', 'Mariam', 'مريم', 'F', 1933, 2015, 'mansouri', {
      occupation: 'Teacher',
      marriedIntoNote: 'Married into the Al Dhaheri family of Dubai (1952)',
    }),
    P('s1', 'Saeed', 'سعيد', 'M', 1936, 2012, 'mansouri', { occupation: 'Merchant' }),
    P('ra', 'Rashid', 'راشد', 'M', 1957, null, 'mansouri', {
      occupation: 'Chairman, Al Mansouri Trading',
      education: 'BA Commerce, UAE University',
      kunya: 'Abu Khalid',
    }),
    P('he', 'Hessa', 'حصة', 'F', 1960, null, 'mansouri', { occupation: 'Doctor', education: 'MBBS' }),
    P('om', 'Omar', 'عمر', 'M', 1972, null, 'mansouri', { occupation: 'Engineer' }),
    P('su', 'Sultan', 'سلطان', 'M', 1964, null, 'mansouri', { occupation: 'Banker' }),
    P('la', 'Latifa', 'لطيفة', 'F', 1967, null, 'mansouri', { occupation: 'Architect' }),
    P('kh', 'Khalid', 'خالد', 'M', 1986, null, 'mansouri', {
      occupation: 'CEO, Mansouri Logistics',
      education: 'MBA, INSEAD',
    }),
    P('mh', 'Mohammed', 'محمد', 'M', 1989, null, 'mansouri', { occupation: 'Pilot' }),
    P('sa', 'Sara', 'سارة', 'F', 1992, null, 'mansouri', { occupation: 'Lawyer' }),
    P('hm', 'Hamdan', 'حمدان', 'M', 1992, null, 'mansouri', { occupation: 'Operations director' }),
    P('al', 'Alyaa', 'علياء', 'F', 1995, null, 'mansouri', { occupation: 'Designer' }),
    P('za', 'Zayed', 'زايد', 'M', 2022, null, 'mansouri'),
    P('ft', 'Fatima', 'فاطمة', 'F', 2016, null, 'mansouri'),
    P('rs', 'Rashid', 'راشد', 'M', 2019, null, 'mansouri'),
    P('mz', 'Maitha', 'ميثاء', 'F', 2018, null, 'mansouri'),
    // Married in
    P('ai', 'Aisha', 'عائشة', 'F', 1935, 2018, 'zaabi'),
    P('no', 'Noura', 'نورة', 'F', 1945, null, 'suwaidi'),
    P('sh', 'Shaikha', 'شيخة', 'F', 1940, null, 'mazrouei'),
    P('re', 'Reem', 'ريم', 'F', 1994, null, 'hammadi'),
    P('mo', 'Moza', 'موزة', 'F', 1968, null, 'ketbi'),
    P('da', 'Dana', 'دانة', 'F', 1990, null, 'marri'),
    P('yo', 'Yousef', 'يوسف', 'M', 1958, null, 'nuaimi', { occupation: 'Professor' }),
  ],
  marriedIn: ['f1', 'ai', 'no', 'sh', 'am', 're', 'mo', 'da', 'yo'],
  unions: [
    { a: 'k1', b: 'f1', year: 1928, kids: ['a1', 'm1', 's1'] },
    { a: 'a1', b: 'ai', year: 1955, kids: ['ra', 'he'] },
    { a: 'a1', b: 'no', year: 1970, kids: ['om'] },
    { a: 's1', b: 'sh', year: 1962, kids: ['su', 'la'] },
    { a: 'ra', b: 'am', year: 1984, kids: ['kh', 'mh', 'sa'] },
    { a: 'he', b: 'yo', year: 1982, kids: [] },
    { a: 'su', b: 'mo', year: 1990, kids: ['hm', 'al'] },
    { a: 'om', b: 're', year: 2017, kids: ['mz', 'za'] },
    { a: 'kh', b: 'da', year: 2014, kids: ['ft', 'rs'] },
  ],
  businesses: [
    {
      id: 'b1',
      data: {
        name: 'Mansouri Pearling',
        nameAr: 'لؤلؤ المنصوري',
        type: 'TRADING',
        startedYear: 1950,
        endedYear: 1972,
        status: 'CLOSED',
        city: 'Abu Dhabi',
        country: 'UAE',
        description: 'Pearl buying and trading in the old souq.',
      },
      owners: [['k1', 'OWNER']],
    },
    {
      id: 'b2',
      data: {
        name: 'Al Mansouri Trading',
        nameAr: 'المنصوري للتجارة',
        type: 'IMPORT_EXPORT',
        startedYear: 1962,
        status: 'ACTIVE',
        address: 'Hamdan Bin Mohammed St, Al Markaziyah',
        city: 'Abu Dhabi',
        country: 'UAE',
        phone: '+971 2 626 0000',
        email: 'info@mansouri-trading.example.ae',
        website: 'https://mansouri-trading.example.ae',
        registrationNo: 'CN-1004587',
        employeesRange: '201-1000',
        branches: ['Dubai', 'Al Ain', 'Muscat'],
        description: 'Import and distribution of building materials and foodstuffs across the Gulf.',
        lat: 24.4889,
        lng: 54.3627,
      },
      owners: [
        ['a1', 'OWNER'],
        ['s1', 'PARTNER'],
        ['ra', 'DIRECTOR'],
      ],
    },
    {
      id: 'b3',
      data: {
        name: 'Mansouri Logistics',
        nameAr: 'المنصوري للخدمات اللوجستية',
        type: 'SERVICES',
        startedYear: 2010,
        status: 'ACTIVE',
        city: 'Dubai',
        country: 'UAE',
        address: 'Jebel Ali Free Zone, South',
        phone: '+971 4 880 0000',
        email: 'hello@mansouri-logistics.example.ae',
        website: 'https://mansouri-logistics.example.ae',
        registrationNo: 'JAFZA-77812',
        employeesRange: '51-200',
        branches: ['Abu Dhabi'],
        description: 'Freight forwarding and warehousing out of Jebel Ali.',
      },
      owners: [
        ['kh', 'CO_FOUNDER'],
        ['hm', 'CO_FOUNDER'],
      ],
    },
    {
      id: 'b4',
      data: {
        name: 'Latifa Studio',
        nameAr: 'استوديو لطيفة',
        type: 'PROFESSIONAL',
        startedYear: 2001,
        status: 'ACTIVE',
        city: 'Dubai',
        country: 'UAE',
        description: 'Architecture practice: villas and heritage restoration.',
        employeesRange: '11-50',
        email: 'studio@latifa.example.ae',
      },
      owners: [['la', 'OWNER']],
    },
  ],
};

const KAABI: FamilySeed = {
  family: familyRecord('fam-kaabi', 'Al Kaabi Family', 'عائلة الكعبي', '#b7862c', {
    surname: 'Al Kaabi',
    nativePlace: 'Al Ain',
    description: 'Date farmers and camel breeders from the oases of Al Ain.',
  }),
  people: [
    P('ob', 'Obaid', 'عبيد', 'M', 1878, 1950, 'kaabi', { occupation: 'Date farmer', kunya: 'Abu Juma' }),
    P('sl', 'Salama', 'سلامة', 'F', 1884, 1961, 'nuaimi'),
    P('f1', 'Fatima', 'فاطمة', 'F', 1910, 1990, 'kaabi', {
      notes: 'Married Khalid Al Mansouri in 1928 and moved to Abu Dhabi island.',
    }),
    P('ju', 'Juma', 'جمعة', 'M', 1912, 1985, 'kaabi', { occupation: 'Date farmer' }),
    P('hi', 'Hind', 'هند', 'F', 1918, 1999, 'shamsi'),
    P('mj', 'Majid', 'ماجد', 'M', 1940, 2020, 'kaabi', { occupation: 'Camel breeder' }),
    P('ms', 'Mariam', 'مريم', 'F', 1944, null, 'kaabi', {
      marriedIntoNote: 'Married into the Al Ameri family of Liwa',
    }),
    P('ab', 'Abdullah', 'عبدالله', 'M', 1968, null, 'kaabi', { occupation: 'Farm owner' }),
    P('ha', 'Hamad', 'حمد', 'M', 1971, null, 'kaabi', { occupation: 'Veterinarian' }),
    P('mr', 'Maryam', 'مريم', 'F', 1974, null, 'kaabi', { occupation: 'Nurse' }),
    P('sf', 'Saif', 'سيف', 'M', 1998, null, 'kaabi', { occupation: 'Student' }),
    P('hn', 'Hind', 'هند', 'F', 2001, null, 'kaabi', { occupation: 'Student' }),
    P('wf', 'Wadeema', 'وديمة', 'F', 1946, null, 'suwaidi'),
    P('me', 'Meera', 'ميرة', 'F', 1972, null, 'zaabi'),
  ],
  marriedIn: ['sl', 'hi', 'wf', 'me'],
  unions: [
    { a: 'ob', b: 'sl', year: 1905, kids: ['f1', 'ju'] },
    { a: 'ju', b: 'hi', year: 1938, kids: ['mj', 'ms'] },
    { a: 'mj', b: 'wf', year: 1966, kids: ['ab', 'ha', 'mr'] },
    { a: 'ab', b: 'me', year: 1995, kids: ['sf', 'hn'] },
  ],
  businesses: [
    {
      id: 'b5',
      data: {
        name: 'Kaabi Date Farms',
        nameAr: 'مزارع الكعبي للتمور',
        type: 'AGRICULTURE',
        startedYear: 1946,
        status: 'ACTIVE',
        city: 'Al Ain',
        country: 'UAE',
        phone: '+971 3 765 0000',
        registrationNo: 'AA-22091',
        employeesRange: '11-50',
        description: 'Khalas and Lulu dates from family palm groves in Al Ain.',
      },
      owners: [
        ['ju', 'OWNER'],
        ['mj', 'OWNER'],
        ['ab', 'MANAGER'],
      ],
    },
    {
      id: 'b6',
      data: {
        name: 'Al Kaabi Veterinary Clinic',
        nameAr: 'عيادة الكعبي البيطرية',
        type: 'SERVICES',
        startedYear: 2004,
        status: 'ACTIVE',
        city: 'Al Ain',
        country: 'UAE',
        email: 'clinic@kaabi-vet.example.ae',
      },
      owners: [['ha', 'OWNER']],
    },
  ],
};

const SHAMSI: FamilySeed = {
  family: familyRecord('fam-shamsi', 'Al Shamsi Family', 'عائلة الشامسي', '#7a5cc7', {
    surname: 'Al Shamsi',
    nativePlace: 'Sharjah',
    description: 'Textile traders from the Sharjah creek.',
  }),
  people: [
    P('as', 'Ali', 'علي', 'M', 1932, 2010, 'shamsi', { occupation: 'Textile trader' }),
    P('hs', 'Hamda', 'حمدة', 'F', 1936, 2019, 'ketbi'),
    P('am', 'Amna', 'آمنة', 'F', 1962, null, 'shamsi', { occupation: 'School principal' }),
    P('sm', 'Saif', 'سيف', 'M', 1959, null, 'shamsi', { occupation: 'Textile trader' }),
    P('nm', 'Nasser', 'ناصر', 'M', 1965, null, 'shamsi', { occupation: 'Accountant' }),
    P('wd', 'Wadha', 'وضحى', 'F', 1963, null, 'marri'),
    P('aa', 'Ahmed', 'أحمد', 'M', 1988, null, 'shamsi', { occupation: 'Software engineer' }),
    P('ns', 'Noor', 'نور', 'F', 1991, null, 'shamsi', { occupation: 'Pharmacist' }),
  ],
  marriedIn: ['hs', 'wd'],
  unions: [
    { a: 'as', b: 'hs', year: 1956, kids: ['sm', 'am', 'nm'] },
    { a: 'sm', b: 'wd', year: 1986, kids: ['aa', 'ns'] },
  ],
  businesses: [
    {
      id: 'b7',
      data: {
        name: 'Shamsi Textiles',
        nameAr: 'الشامسي للأقمشة',
        type: 'TEXTILE',
        startedYear: 1958,
        status: 'ACTIVE',
        city: 'Sharjah',
        country: 'UAE',
        address: 'Souq Al Arsah',
        phone: '+971 6 568 0000',
        registrationNo: 'SHJ-5531',
        employeesRange: '11-50',
      },
      owners: [
        ['as', 'OWNER'],
        ['sm', 'OWNER'],
      ],
    },
  ],
};

const MALE: ReadonlyArray<readonly [string, string]> = [
  ['Khalid', 'خالد'],
  ['Ahmed', 'أحمد'],
  ['Saeed', 'سعيد'],
  ['Rashid', 'راشد'],
  ['Omar', 'عمر'],
  ['Sultan', 'سلطان'],
  ['Hamdan', 'حمدان'],
  ['Mohammed', 'محمد'],
  ['Zayed', 'زايد'],
  ['Majid', 'ماجد'],
  ['Faisal', 'فيصل'],
  ['Saif', 'سيف'],
  ['Hamad', 'حمد'],
  ['Ali', 'علي'],
  ['Yousef', 'يوسف'],
  ['Abdullah', 'عبدالله'],
];
const FEMALE: ReadonlyArray<readonly [string, string]> = [
  ['Fatima', 'فاطمة'],
  ['Aisha', 'عائشة'],
  ['Mariam', 'مريم'],
  ['Hessa', 'حصة'],
  ['Latifa', 'لطيفة'],
  ['Sara', 'سارة'],
  ['Alyaa', 'علياء'],
  ['Moza', 'موزة'],
  ['Noura', 'نورة'],
  ['Shaikha', 'شيخة'],
  ['Amna', 'آمنة'],
  ['Reem', 'ريم'],
  ['Dana', 'دانة'],
  ['Maitha', 'ميثاء'],
  ['Hind', 'هند'],
  ['Salama', 'سلامة'],
];

function rng(seed: number) {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generated ~500-person family, for showing the 3D views at scale. Names and dates are invented. */
function syntheticFamily(target: number): FamilySeed {
  const r = rng(11);
  const pick = <T>(a: readonly T[]) => a[Math.floor(r() * a.length)] as T;
  const others = ['zaabi', 'suwaidi', 'mazrouei', 'hammadi', 'ketbi', 'marri', 'shamsi', 'kaabi'];
  const people: PersonSeed[] = [];
  const marriedIn: string[] = [];
  const unions: Union[] = [];
  const death = (born: number) =>
    born < 1965 && r() < Math.min(0.97, (2026 - born - 50) / 45)
      ? Math.min(2025, born + 52 + Math.floor(r() * 38))
      : null;
  const mk = (sex: 'M' | 'F', born: number, family: string) => {
    const n = pick(sex === 'M' ? MALE : FEMALE);
    const p = P(`n${people.length}`, n[0], n[1], sex, born, death(born), family);
    people.push(p);
    if (family !== 'nuaimi') marriedIn.push(p.id);
    return p;
  };
  const root = mk('M', 1872, 'nuaimi');
  root.died = 1941;
  const queue = [root];
  while (queue.length && people.length < target) {
    const p = queue.shift() as PersonSeed;
    if (p.sex === 'F' && r() < 0.6) continue; // most daughters marry into other families
    const wed = p.born + 21 + Math.floor(r() * 8);
    if (wed > 2021) continue;
    const s = mk(p.sex === 'M' ? 'F' : 'M', p.born + (p.sex === 'M' ? 2 : -3) + Math.floor(r() * 4), pick(others));
    const u: Union = { a: p.id, b: s.id, year: wed, kids: [] };
    unions.push(u);
    let y = wed;
    const nk = 2 + Math.floor(r() * 5);
    for (let i = 0; i < nk && people.length < target; i++) {
      y += 1 + Math.floor(r() * 3);
      if (y > 2025) break;
      const c = mk(r() < 0.55 ? 'M' : 'F', y, 'nuaimi');
      u.kids.push(c.id);
      queue.push(c);
    }
  }
  return {
    family: familyRecord('fam-nuaimi', 'Al Nuaimi Family (large sample)', 'عائلة النعيمي (عينة كبيرة)', '#2f7fb8', {
      surname: 'Al Nuaimi',
      nativePlace: 'Ajman',
      description: 'A generated family of about 500 people, used to show how the views handle a large tree.',
    }),
    people,
    marriedIn,
    unions,
    businesses: [],
  };
}

function blankBusiness(id: string, familyId: string): Business {
  return {
    id,
    familyId,
    name: '',
    nameAr: null,
    type: 'OTHER',
    typeOther: null,
    description: null,
    startedYear: null,
    endedYear: null,
    status: 'ACTIVE',
    address: null,
    city: null,
    state: null,
    country: null,
    lat: null,
    lng: null,
    phone: null,
    email: null,
    website: null,
    socialLinks: { instagram: null, facebook: null, linkedin: null, whatsapp: null },
    registrationNo: null,
    employeesRange: null,
    branches: [],
    logoUrl: null,
    deletedAt: null,
  };
}

export const DEMO_USERS: User[] = [
  {
    id: 'u-super',
    clientId: DEMO_CLIENT_ID,
    name: 'Hamad Al Mansouri',
    email: 'hamad@example.ae',
    isSuperAdmin: true,
    locale: 'ar',
  },
  {
    id: 'u-admin-mansouri',
    clientId: DEMO_CLIENT_ID,
    name: 'Rashid Al Mansouri',
    email: 'rashid@example.ae',
    isSuperAdmin: false,
    locale: 'ar',
  },
  {
    id: 'u-admin-two',
    clientId: DEMO_CLIENT_ID,
    name: 'Omar Al Mansouri',
    email: 'omar@example.ae',
    isSuperAdmin: false,
    locale: 'en',
  },
  {
    id: 'u-admin-kaabi',
    clientId: DEMO_CLIENT_ID,
    name: 'Hamad Al Kaabi',
    email: 'hamad.kaabi@example.ae',
    isSuperAdmin: false,
    locale: 'ar',
  },
  {
    id: 'u-viewer',
    clientId: DEMO_CLIENT_ID,
    name: 'Dana Al Marri',
    email: 'dana@example.ae',
    isSuperAdmin: false,
    locale: 'ar',
  },
];

const DEMO_MEMBERS: FamilyMember[] = [
  { userId: 'u-admin-mansouri', familyId: 'fam-mansouri', role: 'ADMIN' },
  { userId: 'u-admin-two', familyId: 'fam-mansouri', role: 'ADMIN' },
  { userId: 'u-admin-two', familyId: 'fam-kaabi', role: 'ADMIN' },
  { userId: 'u-admin-kaabi', familyId: 'fam-kaabi', role: 'ADMIN' },
  { userId: 'u-viewer', familyId: 'fam-mansouri', role: 'VIEWER' },
];

export function buildSeed(): Omit<DemoDb, 'version' | 'sessionUserId'> {
  const client: Client = { id: DEMO_CLIENT_ID, name: 'Al Mansouri Family Office' };
  const seeds = [MANSOURI, KAABI, SHAMSI, syntheticFamily(500)];
  const people = new Map<string, Person>();
  const familyPeople: FamilyPerson[] = [];
  const parentChild: ParentChild[] = [];
  const marriages: Marriage[] = [];
  const businesses: Business[] = [];
  const personBusiness: PersonBusiness[] = [];
  const familyOf = new Map<string, string>(); // person id → birth family id

  for (const seed of seeds) {
    for (const s of seed.people) {
      if (!people.has(s.id)) people.set(s.id, toPerson(s));
      if (!seed.marriedIn.includes(s.id)) familyOf.set(s.id, seed.family.id);
    }
  }
  for (const seed of seeds) {
    const fid = seed.family.id;
    const add = (personId: string, membership: FamilyPerson['membership']) => {
      if (!people.has(personId)) return;
      if (!familyPeople.some((fp) => fp.familyId === fid && fp.personId === personId)) {
        familyPeople.push({ familyId: fid, personId, membership });
      }
    };
    for (const s of seed.people) add(s.id, seed.marriedIn.includes(s.id) ? 'MARRIED_IN' : 'BORN');
    for (const id of seed.marriedIn) add(id, 'MARRIED_IN');
    for (const u of seed.unions) {
      if (!people.has(u.a) || !people.has(u.b)) continue;
      marriages.push({
        id: `m-${u.a}-${u.b}`,
        personAId: u.a,
        personBId: u.b,
        status: u.status ?? 'MARRIED',
        startDate: u.year ? makePartialDate(u.year) : null,
        endDate: u.ended ? makePartialDate(u.ended) : null,
      });
      for (const kid of u.kids) {
        for (const parent of [u.a, u.b]) {
          parentChild.push({ id: `pc-${parent}-${kid}`, parentId: parent, childId: kid, type: 'BIOLOGICAL' });
        }
      }
    }
    for (const b of seed.businesses) {
      businesses.push({ ...blankBusiness(b.id, fid), ...b.data });
      for (const [personId, role] of b.owners) personBusiness.push({ personId, businessId: b.id, role });
    }
  }

  // Women who married in keep their maiden name.
  for (const p of people.values()) {
    const marriedIn = familyPeople.some((fp) => fp.personId === p.id && fp.membership === 'MARRIED_IN');
    if (marriedIn && p.gender === 'FEMALE' && !familyOf.has(p.id)) p.maidenName = p.lastName;
  }
  for (const id of ['f1', 'am']) {
    const p = people.get(id);
    if (p) p.maidenName = p.lastName;
  }

  return {
    clients: [client],
    users: DEMO_USERS,
    familyMembers: DEMO_MEMBERS,
    families: seeds.map((s) => s.family),
    people: [...people.values()],
    familyPeople,
    parentChild,
    marriages,
    businesses,
    personBusiness,
  };
}
