<div dir="rtl">

# צפייה בהתכתבויות Claude Code

לוח מקומי לקריאה בלבד של קובצי השיחה (`.jsonl`) של Claude Code.
בחלק העליון בוחרים פרויקט ואחר כך קובץ שיחה. בחלק התחתון השיחה מוצגת ככרטיסי הודעות, עם חיפוש, סינון וצפייה ב-JSON הגולמי.

## דרישות

- ‏Windows עם Node.js בגרסה 20 ומעלה (נבדק עם Node 26).
- ‏Microsoft Edge או Chrome. הדפדפן נדרש רק לבדיקות ה-E2E, לא להפעלה.

## התקנה והפעלה (PowerShell)

<div dir="ltr">

```powershell
cd D:\Claude-Code\Claude-Code-correspondence
npm install
npm run build
npm start
```

</div>

פתחו בדפדפן את הכתובת: <span dir="ltr">`http://127.0.0.1:5178/`</span>

עוצרים את השרת עם <span dir="ltr">`Ctrl+C`</span>. החיבור לאינטרנט נדרש רק ל-`npm install`. אחרי ההתקנה הכול עובד בלי רשת.

### מצב הדגמה (נתונים בדויים בלבד)

<div dir="ltr">

```powershell
npm run build
npm run demo
```

</div>

## הגדרות

כברירת מחדל, תיקיית השורש היא <span dir="ltr">`C:\Users\Avishay\.claude\projects`</span>.
ההגדרה נקבעת בצד השרת בלבד. בקשה מהדפדפן לא יכולה להחליף אותה.

| הגדרה | משתנה סביבה | שדה ב-<span dir="ltr">`config.local.json`</span> | ברירת מחדל |
|---|---|---|---|
| תיקיית שורש | <span dir="ltr">`CCV_ROOT`</span> | <span dir="ltr">`root`</span> | <span dir="ltr">`C:\Users\Avishay\.claude\projects`</span> |
| פורט | <span dir="ltr">`CCV_PORT`</span> | <span dir="ltr">`port`</span> | <span dir="ltr">`5178`</span> |
| מגבלת גודל קובץ (MB) | <span dir="ltr">`CCV_MAX_FILE_MB`</span> | <span dir="ltr">`maxFileMB`</span> | <span dir="ltr">`256`</span> |

דוגמה:

<div dir="ltr">

```powershell
$env:CCV_ROOT = "D:\other\projects"; $env:CCV_PORT = "5180"; npm start
```

</div>

את הקובץ <span dir="ltr">`config.local.json`</span> שמים ליד <span dir="ltr">`package.json`</span>, והוא מוחרג מ-git. סדר העדיפויות: משתנה סביבה, אחריו הקובץ, ואחריו ברירת המחדל.

## בדיקות

<div dir="ltr">

```powershell
npm run typecheck
npm test          # Vitest
npm run build
npm run e2e       # headless Edge, fictional fixtures, screenshots in .\screenshots
```

</div>

> הריצו את `npm test` מ-PowerShell או מ-cmd. ב-Git Bash, אותיות הכונן (`/d/` לעומת `D:`) גורמות ל-Vitest לטעון את עצמו פעמיים, והבדיקות נכשלות עוד לפני שהן רצות.

## אבטחה ופרטיות

- השרת מאזין רק ל-<span dir="ltr">`127.0.0.1`</span>. הוא בודק את כותרות `Host` ו-`Origin` ודוחה בקשות חוצות-אתרים. אין בו CORS בכלל, והוא מקבל רק בקשות GET ו-HEAD.
- הבקשות מזהות פרויקט בשם התיקייה בלבד, וקובץ בנתיב יחסי שחייב להופיע ברשימה שהשרת עצמו מחזיר. השרת דוחה מעבר תיקיות (`..`), נתיבים מוחלטים, אותיות כונן, שמות עם `:` ושמות שאינם `.jsonl`.
- השרת לא עוקב אחרי קישורים סמליים (symlink) או junction. כל נתיב עובר <span dir="ltr">`realpath`</span>, ונבדק שוב שהוא נמצא בתוך השורש.
- הקבצים נפתחים לקריאה בלבד. אין בשרת שום API לכתיבה, למחיקה או להרצת פקודות.
- תוכן ההודעות מוצג כטקסט. Markdown מפוענח בלי HTML גולמי, ואין שימוש ב-`innerHTML`. נוצרים קישורים רק לכתובות `http`, `https` ו-`mailto`. הם נפתחים בלשונית חדשה עם <span dir="ltr">`noopener noreferrer`</span>, ורק כשלוחצים עליהם. תמונות לא נטענות אף פעם.
- מדיניות CSP קפדנית (<span dir="ltr">`default-src 'none'`</span>). אין CDN, אין טלמטריה ואין שליחה החוצה.
- השיחה נשמרת בזיכרון של הלשונית בלבד, לא ב-localStorage ולא במטמון (<span dir="ltr">`Cache-Control: no-store`</span>). יומן השרת רושם רק שיטה, נתיב API, סטטוס וזמן, בלי שמות קבצים ובלי תוכן.

## מתאמי רשומות נתמכים

כל רשומה נשמרת במקור, ואפשר לפתוח אותה כ-JSON גולמי. המתאמים נבדקים לפי הסדר הזה:

| מתאם | תנאי זיהוי | תצוגה |
|---|---|---|
| <span dir="ltr">`message-envelope`</span> | <span dir="ltr">`type` = `user`/`assistant`</span> וגם <span dir="ltr">`message.content`</span> | כרטיס משתמש או עוזר. הודעת user שכל תוכנה <span dir="ltr">`tool_result`</span> מוצגת כ"תוצאת כלי" |
| <span dir="ltr">`summary`</span> | <span dir="ltr">`type` = `summary`</span> עם <span dir="ltr">`summary`</span> מסוג מחרוזת | כרטיס סיכום |
| <span dir="ltr">`system`</span> | <span dir="ltr">`type` = `system`</span> | רשומת מערכת (<span dir="ltr">`content`</span> ו-<span dir="ltr">`subtype`</span> אם הם קיימים) |
| <span dir="ltr">`bare-message`</span> | <span dir="ltr">`role` = `user`/`assistant`</span> ו-<span dir="ltr">`content`</span> בלי מעטפת | כמו הודעה רגילה |
| <span dir="ltr">`attachment`</span> | <span dir="ltr">`type` = `attachment`</span> עם אובייקט <span dir="ltr">`attachment`</span> | שורה מקוצרת "צרופה: <span dir="ltr">`attachment.type`</span>" עם <span dir="ltr">`renderedRole`</span>. התוכן מהשדה <span dir="ltr">`rendered[].content`</span> נפתח לפי בקשה |
| <span dir="ltr">`ai-title`</span> | <span dir="ltr">`type` = `ai-title`</span> עם <span dir="ltr">`aiTitle`</span> מסוג מחרוזת | שורה מקוצרת עם הכותרת. הכותרת האחרונה מוצגת בכותרת השיחה כתווית משנית |
| <span dir="ltr">`typed-other`</span> | כל <span dir="ltr">`type`</span> אחר | שורת מטא-נתונים מקוצרת. ה-JSON נפתח לפי בקשה |
| <span dir="ltr">`unknown`</span> | כל מבנה אחר | פריט "רשומה לא מוכרת" עם JSON |

בלוקי תוכן: `text`, `thinking`, <span dir="ltr">`redacted_thinking`</span> (מוצג כ"מוסתר", בלי להמציא תוכן), <span dir="ltr">`tool_use`</span> ו-<span dir="ltr">`tool_result`</span> (מקושרים לפי <span dir="ltr">`id`</span> / <span dir="ltr">`tool_use_id`</span>), `image` ו-`document` (רק מטא-נתונים, לא מוצגים). בלוק לא מוכר מוצג כ-JSON גולמי.
השדות <span dir="ltr">`uuid`</span>, <span dir="ltr">`parentUuid`</span>, <span dir="ltr">`timestamp`</span>, <span dir="ltr">`isSidechain`</span>, <span dir="ltr">`isMeta`</span> ו-<span dir="ltr">`cwd`</span> מוצגים רק אם הם קיימים ברשומה.

## פענוח

- הקובץ נקרא שורה פיזית אחר שורה, ב-UTF-8, עם טיפול ב-BOM וב-CRLF. שורות ריקות מדולגות, ומספרי השורות נשמרים.
- שורה פגומה מוצגת כאזהרה עם מספר השורה, והפענוח ממשיך. אפשר לפתוח את השורה הגולמית לפי בקשה.
- שורה אחרונה בלי ירידת שורה, שאינה JSON שלם, מסומנת כ"חלקית". ייתכן שהקובץ עדיין נכתב, ולכן מרעננים ידנית.
- השרת שולח תמונת מצב של הקובץ לפי גודלו ברגע הפתיחה, כך שרענון אף פעם לא מערבב שתי גרסאות. ברענון מיקום הקריאה נשמר לפי מספר השורה.
- הסתעפויות (כמה רשומות עם אותו <span dir="ltr">`parentUuid`</span>) מסומנות, והסדר נשאר סדר הקובץ. רשומות כפולות לא מוסרות. קבצים בתתי-תיקיות (למשל קובצי subagent) מוצגים בנפרד, לפי הנתיב היחסי שלהם.

## מבנה שנצפה בקובץ אמיתי (מבנה בלבד)

נבדק קובץ אמיתי אחד, באישור המשתמש: 39 רשומות, כ-212 KB. הבדיקה הציגה רק שמות שדות, סוגי ערכים וערכי `type`, בלי טקסט של הודעות.

- **שיחה (5 רשומות):** רשומות `user` ו-`assistant` עם <span dir="ltr">`message.content`</span> מסוג מחרוזת או מערך של בלוקי `text`, <span dir="ltr">`tool_use`</span> ו-<span dir="ltr">`tool_result`</span>. התוכן של <span dir="ltr">`tool_result`</span> היה מחרוזת. יש גם רשומת `system` מסוג <span dir="ltr">`turn_duration`</span>, בלי תוכן.
- **רשומות `attachment` (12):** הקשר שהוזרק לשיחה, עם <span dir="ltr">`attachment.type`</span> כמו `environment`, `date`, `model`, <span dir="ltr">`skill_listing`</span> ו-<span dir="ltr">`prompt_snapshot`</span>. ברובן יש <span dir="ltr">`rendered: [{content}]`</span> ו-<span dir="ltr">`renderedRole`</span> (`system` או `user`).
- **רשומות ניהול:** <span dir="ltr">`ai-title`</span>, <span dir="ltr">`last-prompt`</span>, <span dir="ltr">`mode`</span>, <span dir="ltr">`permission-mode`</span>, <span dir="ltr">`api-request`</span>, <span dir="ltr">`api-request-blob`</span>, <span dir="ltr">`api-request-shape`</span>, <span dir="ltr">`cost-state`</span>, <span dir="ltr">`tools-used`</span>, <span dir="ltr">`file-history-snapshot`</span>, <span dir="ltr">`file-history-delta`</span>, <span dir="ltr">`atis-latch`</span>.
- ברשומות <span dir="ltr">`api-request-blob`</span> יש שדה <span dir="ltr">`message`</span>, אבל הן עותק של בקשת API ולא תור בשיחה. לכן הן מוצגות כמטא-נתונים ולא ככרטיס משתמש.

הבדיקה נעשתה עם <span dir="ltr">`scripts/inspect-structure.mjs`</span> ו-<span dir="ltr">`scripts/inspect-structure-2.mjs`</span>. הסקריפטים קוראים קובץ אחד לקריאה בלבד ומדפיסים מבנה בלבד:

<div dir="ltr">

```powershell
node scripts/inspect-structure.mjs "C:\path\to\file.jsonl"
```

</div>

## מגבלות ידועות

- **המתאמים נבדקו על קובץ אמיתי אחד בלבד** (בדיקת מבנה, ראו למעלה). בקבצים אחרים, או בגרסאות אחרות של Claude Code, עשויים להופיע סוגי רשומות נוספים. הם יוצגו כמטא-נתונים או כ"לא מוכר", עם JSON מלא, ולא יאבדו.
- קובץ שגדול ממגבלת הגודל (ברירת מחדל 256 MB) לא נקרא בכלל, והמשתמש מקבל הודעה על כך. הקובץ אף פעם לא נקטע. קובץ שנטען נשמר כולו בזיכרון הדפדפן.
- התצוגה מחולקת לעמודים של 100 רשומות, בלי וירטואליזציה. ניווט החיפוש עובר בין רשומות, לא בין מופעים בודדים בתוך רשומה. ההדגשה בטקסט דורשת את <span dir="ltr">CSS Custom Highlight API</span> (קיים ב-Edge וב-Chrome העדכניים).
- החיפוש כולל גם JSON של קלט כלים ושל רשומות מטא, ולכן יש התאמות שמופיעות רק אחרי שפותחים פריט מתקפל. פריטים כאלה נפתחים אוטומטית כשהם מכילים התאמה.
- הבדיקה האוטומטית ל-symlink של קובץ דורשת הרשאת מנהל או Developer Mode ב-Windows. בלעדיהן היא מדולגת, והחסימה נבדקת דרך junction. השרת לא מזהה hard links.
- אחרי שקובץ נכתב מחדש (ולא רק הוארך), שחזור המיקום לפי מספר שורה עלול להגיע למקום אחר. במקרה כזה מוצגת הודעה.
- אין מעקב חי אחרי הקובץ. מרעננים ידנית.

</div>
