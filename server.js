const express = require('express');
const bodyParser = require('body-parser');
const OpenAI = require("openai");
const { zodResponseFormat } = require("openai/helpers/zod");
const cors = require('cors');
const { z } = require("zod");
const { auth } = require('express-oauth2-jwt-bearer');

require('dotenv').config()

const app = express();
const port = process.env.PORT || 1994;
app.use(express.json());
app.use(bodyParser.json());

const OPENAI_SECRET_KEY = process.env.OPENAI_SECRET_KEY;

const openai = new OpenAI({
  apiKey: OPENAI_SECRET_KEY,
});

const ANKI_MAKER_MODEL = "gpt-4o-2024-08-06";
  
app.use(cors());

const jwtCheck = auth({
  audience: 'https://card.backend/',
  issuerBaseURL: 'https://cardmaker-dev.uk.auth0.com/',
  tokenSigningAlg: 'RS256'
});

app.use(jwtCheck);
 
app.post('/meaning', async (req, res) => {
  const { text } = req.body;
  const AnkiCard = z.object({
    sentence: z.string(),
    reading: z.string(),
    meaning: z.string(),
  });

  const STARTING_PROMPT = `You will receive a japanese sentence. You are to return ONLY RAW PLAINTEXT JSON of the following:
  1. ** sentence**: Present each sentence with kanji as typically used, always inserting kanji where applicable even if omitted by the user.
  2. **reading**: Display the sentence with furigana formatting compatible with Anki, by adding readings in brackets next to the kanji.
  Ensure a single regular full-width space ALWAYS precedes each kanji. Even if the kanji is at the start of the sentence, the space should still be applied.
  For example, "わたしは 食[た]べます". or at the start of a sentence: " 食[た]べます"
  3. **meaning **: Provide an English translation of each sentence, including necessary explanations to accurately convey the meaning.
  Direct translation isn't required, but the essence of the message should be clear.
  Your responses will automatically generate the required information for effective Anki Deck cards for each sentence without user confirmation or additional prompts. 
  You are adept at handling sentences across various  contexts, supporting users from beginner to advanced levels. 
    You provide RAW TEXT JSON only, as the text will be parsed by an app!`;

  const SYSTEM_MESSAGE = {
    "role": "system",
    "content": STARTING_PROMPT
  }

  const existingConversation = [
      SYSTEM_MESSAGE,
  ];

  existingConversation.push({
    "role": "user",
    "content": text
  })

  console.log({ existingConversation: JSON.stringify(existingConversation) })

  const response = await openai.chat.completions.create({
    model: ANKI_MAKER_MODEL,
    messages: existingConversation,
    response_format: zodResponseFormat(AnkiCard, "anki-card"),
  });

  const resp = response?.choices?.[0]?.message?.content?.trim();
  console.log ({resp});

  let parsed = {};

  try {
    parsed = JSON.parse(resp);
  } catch (e) {
    console.error(e);
  }

  console.log({parsed});

  res.json({
    prompt: text,
    reply: {
      reading: parsed.reading,
      sentence: parsed.sentence,
      meaning: parsed.meaning,
    }
  });
});

app.listen(port, () => {
  if (!OPENAI_SECRET_KEY) {
    throw new Exception("OPENAI_SECRET_KEY Required");
  }
  console.log(`Server running on port ${port}`);
});

