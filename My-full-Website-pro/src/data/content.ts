/**
 * All site copy lives here, separate from the components that render it.
 * Editing text, adding a project or a testimonial means editing this file only.
 */
import type { NavLink, Project, Service, SocialLink, Stat, Testimonial } from '@/types/content';

export const profile = {
  name: 'אבישי גרינברג',
  initials: ['א', 'ג'] as const,
  tagline: 'יועץ אסטרטגיה ומפתח מוצרים דיגיטליים — הופך רעיונות מורכבים לחוויות פשוטות, מדויקות ומשפיעות.',
};

export const navLinks: NavLink[] = [
  { id: 'about', label: 'אודות' },
  { id: 'services', label: 'שירותים' },
  { id: 'portfolio', label: 'עבודות' },
  { id: 'testimonials', label: 'המלצות' },
  { id: 'contact', label: 'צור קשר', isCta: true },
];

export const about = {
  title: 'מעל עשור של בניית מוצרים שאנשים אוהבים',
  paragraphs: [
    'אני משלב חשיבה אסטרטגית עם יכולת ביצוע טכנית. במהלך השנים ליוויתי סטארט־אפים, חברות בינלאומיות וארגונים ציבוריים — מהשלב שבו יש רק רעיון ועד להשקה וצמיחה.',
    'הגישה שלי פשוטה: להקשיב לעומק, להבין את הבעיה האמיתית, ולבנות פתרון נקי, מהיר ומדיד. אני מאמין שעיצוב טוב הוא עיצוב שלא מרגישים — פשוט עובד.',
  ],
  stats: [
    { value: '12+', label: 'שנות ניסיון' },
    { value: '80+', label: 'פרויקטים' },
    { value: '40+', label: 'לקוחות מרוצים' },
  ] satisfies Stat[],
};

export const services: Service[] = [
  {
    id: 'strategy',
    icon: 'strategy',
    title: 'אסטרטגיה דיגיטלית',
    description: 'מיפוי מטרות, קהלים ומתחרים לבניית תוכנית פעולה ברורה שמניעה צמיחה.',
  },
  {
    id: 'design',
    icon: 'design',
    title: 'עיצוב UX/UI',
    description: 'ממשקים אינטואיטיביים ואלגנטיים שמבוססים על מחקר משתמשים אמיתי.',
  },
  {
    id: 'development',
    icon: 'code',
    title: 'פיתוח אתרים ואפליקציות',
    description: 'קוד נקי, מהיר ונגיש — מאתרי תדמית ועד מערכות ווב מורכבות.',
  },
  {
    id: 'growth',
    icon: 'growth',
    title: 'אופטימיזציה וצמיחה',
    description: 'ניתוח נתונים, בדיקות A/B ושיפור מתמיד של המרות וביצועים.',
  },
];

export const projects: Project[] = [
  { id: 'fintech', title: 'פלטפורמת פינטק', description: 'עיצוב ופיתוח מחדש של אפליקציית ניהול השקעות לכ־200 אלף משתמשים.' },
  { id: 'fashion', title: 'חנות אופנה מקוונת', description: 'חוויית קנייה חדשה שהעלתה את שיעור ההמרה ב־38% תוך רבעון.' },
  { id: 'clinics', title: 'מערכת לניהול מרפאות', description: 'מערכת SaaS לתיאום תורים ותיקים רפואיים עבור רשת מרפאות ארצית.' },
  { id: 'branding', title: 'מיתוג לסטארט־אפ', description: 'זהות מותגית מלאה ואתר השקה לחברת בינה מלאכותית בשלב סיד.' },
  { id: 'fitness', title: 'אפליקציית כושר', description: 'אפליקציה חברתית לאימונים עם מעקב התקדמות ואתגרים קבוצתיים.' },
  { id: 'municipal', title: 'פורטל עירוני', description: 'שירותים דיגיטליים נגישים לתושבים, בהתאם לתקן הנגישות הישראלי.' },
];

export const testimonials: Testimonial[] = [
  {
    id: 'michal',
    quote: 'אבישי הבין את הצרכים שלנו טוב יותר מאיתנו. התוצאה עלתה על כל הציפיות, והתהליך היה מקצועי ונעים.',
    name: 'מיכל לוי',
    role: 'מנכ״לית, נובה טק',
    initials: 'מל',
  },
  {
    id: 'uri',
    quote: 'שותף אמיתי. הוא לא רק ביצע — הוא אתגר אותנו לחשוב אחרת, וזה מה שעשה את ההבדל.',
    name: 'אורי ברק',
    role: 'מייסד, פלואו',
    initials: 'אב',
  },
  {
    id: 'noa',
    quote: 'עמידה מדויקת בלוחות זמנים, תקשורת מצוינת ותוצר ברמה בינלאומית. ממליצה בחום.',
    name: 'נועה שחר',
    role: 'סמנכ״לית שיווק, אורבן',
    initials: 'נש',
  },
];

export const contact = {
  title: 'יש לכם פרויקט בראש?',
  lead: 'ספרו לי עליו ואחזור אליכם תוך יום עסקים אחד.',
};

export const socialLinks: SocialLink[] = [
  { icon: 'linkedin', label: 'לינקדאין', href: '#' },
  { icon: 'github', label: 'גיטהאב', href: '#' },
  { icon: 'instagram', label: 'אינסטגרם', href: '#' },
  { icon: 'x', label: 'X (טוויטר)', href: '#' },
];
