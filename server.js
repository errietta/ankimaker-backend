const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const port = 3000;

app.use(bodyParser.json());

app.post('/chat', async (req, res) => {
  const { text } = req.body;

  // Here, you'll call the OpenAI API with the text received from your app
  const response = await axios.post(
    'https://api.openai.com/v1/completions',
    {
      model: 'text-davinci-003', // Specify the model you're using
      prompt: `Your custom prompt here with ${text}`,
      temperature: 0.7,
      max_tokens: 150,
      top_p: 1.0,
      frequency_penalty: 0.0,
      presence_penalty: 0.0,
    },
    {
      headers: {
        'Authorization': `Bearer YOUR_OPENAI_API_KEY`,
      },
    }
  );

  res.json({ reply: response.data.choices[0].text.trim() });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

