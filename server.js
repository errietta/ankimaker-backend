const express = require('express');
const bodyParser = require('body-parser');
const OpenAI = require("openai");
const { zodResponseFormat } = require("openai/helpers/zod");
const cors = require('cors');
const { z } = require("zod");
const { auth } = require('express-oauth2-jwt-bearer');

require('dotenv').config()

const OPENAI_SECRET_KEY = process.env.OPENAI_SECRET_KEY;
const AUTH0_AUDIENCE = "https://card.backend/";
const AUTH0_TOKEN_URL = "https://cardmaker-dev.uk.auth0.com/oauth/token";
const ANKI_MAKER_MODEL = "gpt-4o-2024-08-06";

const app = express();
const port = process.env.PORT || 1994;
app.use(express.json({ limit: '10mb' }));
app.use(bodyParser.json({ limit: '10mb' }));

const openai = new OpenAI({
  apiKey: OPENAI_SECRET_KEY,
});

app.use(cors());

const jwtCheck = auth({
  audience: 'https://card.backend/',
  issuerBaseURL: 'https://cardmaker-dev.uk.auth0.com/',
  tokenSigningAlg: 'RS256'
});

const AnkiCard = z.object({
  sentence: z.string(),
  reading: z.string(),
  meaning: z.string(),
});

function getStartingPrompt(language) {
  if (language === "jp-JP") {
    return `You will receive a japanese sentence. You are to return ONLY RAW PLAINTEXT JSON of the following:
    1. ** sentence**: Present each sentence with kanji as typically used, always inserting kanji where applicable even if omitted by the user.
    2. **reading**: Display the sentence with furigana formatting compatible with Anki, by adding readings in brackets next to the kanji.
    Ensure a single regular full-width space ALWAYS precedes each kanji. Even if the kanji is at the start of the sentence, the space should still be applied.
    For example, "わたしは 食[た]べます". or at the start of a sentence: " 食[た]べます"
    3. **meaning **: Provide an English translation of each sentence, including necessary explanations to accurately convey the meaning.
    Direct translation isn't required, but the essence of the message should be clear.
    Your responses will automatically generate the required information for effective Anki Deck cards for each sentence without user confirmation or additional prompts.
    You are adept at handling sentences across various  contexts, supporting users from beginner to advanced levels.
      You provide RAW TEXT JSON only, as the text will be parsed by an app!`;
  } else if (language === "zh-CN") {
    return `You will receive a SIMPLIFIED Chinese sentence. You are to return ONLY RAW PLAINTEXT JSON of the following:
    1. ** sentence**: Present each sentence with simplified Chinese characters as typically used, always inserting simplified characters where applicable even if omitted by the user.
    2. **reading**: Display the sentence with pinyin formatting compatible with Anki, by adding pinyin in brackets next to the characters.
    Ensure a single regular full-width space ALWAYS precedes each character. Even if the character is at the start of the sentence, the space should still be applied.
    For example, "我[wǒ] 是[shì] 学[xué] 生[shēng]". or at the start of a sentence: " 我[wǒ] 是[shì] 学[xué] 生[shēng]"
    3. **meaning **: Provide an English AND a Japanese translation of each sentence (separated with<br>), including necessary explanations to accurately convey the meaning.
    Direct translation isn't required, but the essence of the message should be clear.
    Your responses will automatically generate the required information for effective Anki Deck cards for each sentence without user confirmation or additional prompts.
    You are adept at handling sentences across various  contexts, supporting users from beginner to advanced levels.
      You provide RAW TEXT JSON only, as the text will be parsed by an app!`;
  }
  return null;
}

async function generateCard(text, language) {
  const STARTING_PROMPT = getStartingPrompt(language);
  if (!STARTING_PROMPT) return null;

  const messages = [
    { role: "system", content: STARTING_PROMPT },
    { role: "user", content: text },
  ];

  console.log({ generateCard: JSON.stringify(messages) });

  const response = await openai.chat.completions.create({
    model: ANKI_MAKER_MODEL,
    messages,
    response_format: zodResponseFormat(AnkiCard, "anki-card"),
  });

  const resp = response?.choices?.[0]?.message?.content?.trim();
  console.log({ resp });

  try {
    return JSON.parse(resp);
  } catch (e) {
    console.error(e);
    return {};
  }
}

const crypto = require('crypto');

// In-memory OCR cache keyed by SHA-256 hash of the image data
const ocrCache = new Map();

function imageCacheKey(imageBase64, imageUrl) {
  const data = imageBase64 || imageUrl;
  return crypto.createHash('sha256').update(data).digest('hex');
}

app.post('/token', async  (req, res) => {
  const raw = JSON.stringify({
    "client_id": req.body.client_id,
    "client_secret": req.body.client_secret,
    "audience": AUTH0_AUDIENCE,
    "grant_type": "client_credentials"
  });

  const requestOptions = {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: raw,
    redirect: "follow"
  };

  try {
    const response = await (await fetch(AUTH0_TOKEN_URL, requestOptions)).json();
    console.log({response});
    return res.json({ "access_token": response.access_token,  "token_type": "Bearer",  "expires_in": response.expires_in });
  } catch (error) {
    console.error("Error fetching token:", error);
    return res.json({ error: "Failed to fetch token" });
  }
});

app.use((req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const apiKey = process.env.API_KEY;
  if (apiKey && authHeader.startsWith('Bearer ') && authHeader.split(' ')[1] === apiKey) {
    return next();
  }
  return jwtCheck(req, res, next);
});

app.post('/meaning', async (req, res) => {
  const { text } = req.body;
  const language = req.body.language || "jp-JP";

  if (!getStartingPrompt(language)) {
    return res.status(400).json({ error: "Unsupported language" });
  }

  const parsed = await generateCard(text, language);

  res.json({
    prompt: text,
    reply: {
      reading: parsed.reading,
      sentence: parsed.sentence,
      meaning: parsed.meaning,
    }
  });
});

app.post('/meaning/photo', async (req, res) => {
  // Gate behind use:photo-ocr permission for JWT auth users
  if (req.auth) {
    const permissions = req.auth?.payload?.permissions || [];
    if (!permissions.includes('use:photo-ocr')) {
      return res.status(403).json({ error: 'Forbidden: use:photo-ocr permission required' });
    }
  }

  const { language = "jp-JP", imageBase64, imageUrl, mimeType } = req.body;

  if (!imageBase64 && !imageUrl) {
    return res.status(400).json({ error: "imageBase64 or imageUrl is required" });
  }
  if (imageBase64 && imageUrl) {
    return res.status(400).json({ error: "Provide only one of imageBase64 or imageUrl" });
  }
  if (!getStartingPrompt(language)) {
    return res.status(400).json({ error: "Unsupported language" });
  }

  const cacheKey = imageCacheKey(imageBase64, imageUrl);

  let extractedText = ocrCache.get(cacheKey);

  if (extractedText) {
    console.log({ ocrCacheHit: cacheKey });
  } else {
    const imageUrlContent = imageBase64
      ? `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`
      : imageUrl;

    try {
      const ocrResponse = await openai.chat.completions.create({
        model: ANKI_MAKER_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Extract all text from this image. Return only the extracted text, nothing else." },
              { type: "image_url", image_url: { url: imageUrlContent, detail: "high" } }
            ]
          }
        ]
      });

      extractedText = ocrResponse?.choices?.[0]?.message?.content?.trim();
      console.log({ extractedText });

      if (!extractedText) {
        return res.status(422).json({ error: "No text found in image" });
      }

      ocrCache.set(cacheKey, extractedText);
    } catch (e) {
      console.error("OCR error:", e);
      return res.status(500).json({ error: "Failed to extract text from image" });
    }
  }

  try {
    const parsed = await generateCard(extractedText, language);
    res.json({
      prompt: extractedText,
      reply: {
        reading: parsed.reading,
        sentence: parsed.sentence,
        meaning: parsed.meaning,
      }
    });
  } catch (e) {
    console.error("Card generation error:", e);
    return res.status(500).json({ error: "Failed to generate card" });
  }
});

app.listen(port, () => {
  if (!OPENAI_SECRET_KEY) {
    throw new Error("OPENAI_SECRET_KEY Required");
  }
  console.log(`Server running on port ${port}`);
});
