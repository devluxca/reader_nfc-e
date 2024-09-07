const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const axios = require('axios');
const cheerio = require('cheerio');
const FormData = require('form-data');

const upload = multer({ storage: multer.memoryStorage() });

const app = express();

function consolidateItems(items) {
    const itemMap = {};

    items.forEach(item => {
        const key = `${item.title}-${item.code}`;

        if (itemMap[key]) {
            itemMap[key].qtd += item.qtd;
            itemMap[key].amountTotal += item.amountTotal;
        } else {
            itemMap[key] = { ...item };
        }
    });

    return Object.values(itemMap).map(item => {
        item.qtd = item.qtd.toString();
        item.amountUnit = item.amountUnit.toFixed(2).replace('.', ',');
        item.amountTotal = item.amountTotal.toFixed(2).replace('.', ',');
        return item;
    });
}
async function decodeQRCodeUsingAPI(imageBuffer) {
    const formData = new FormData();
    formData.append('file', imageBuffer, 'qrcode.png');

    const result = await axios.post('https://api.qrserver.com/v1/read-qr-code/', formData, {
        headers: {
            'Content-Type': `multipart/form-data; boundary=${formData._boundary}`,
        },
    });

    const qrData = result.data[0].symbol[0].data;

    if (!qrData) {
        throw new Error('QR Code não foi detectado ou está vazio');
    }

    return qrData;
}

// Função para processar a imagem e obter os dados consolidados
async function processImageAndExtractData(imageBuffer) {
    // Carregar a imagem e convertê-la para um formato adequado para o jsQR (RGBA)
    const { data, info } = await sharp(imageBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    // Detectar o QR Code usando a API
    const qrCodeData = await decodeQRCodeUsingAPI(imageBuffer);

    // Fazer a requisição para o link extraído do QR Code e processar o HTML
    const htmlContent = await axios.get(qrCodeData).then(res => res.data);

    // Carregar o HTML no cheerio para processar
    const $ = cheerio.load(htmlContent);

    // Pegar todas as linhas (<tr>) da tabela
    const rows = $('tr[id^="Item"]'); // Seleciona todas as <tr> que possuem id começando com "Item"

    // Array para armazenar os objetos dos itens
    const itemsArray = [];

    // Iterar sobre cada linha da tabela e extrair os dados
    rows.each((index, row) => {
        const title = $(row).find('.txtTit').first().text().trim();
        const code = $(row).find('.RCod').text().replace(/[^0-9]/g, '').trim();
        const qtdText = $(row).find('.Rqtd').text().replace('Qtde.:', '').trim();
        const qtd = parseFloat(qtdText.replace(',', '.'));
        const amountUnitText = $(row).find('.RvlUnit').text().replace('Vl. Unit.:', '').trim();
        const amountUnit = parseFloat(amountUnitText.replace(',', '.'));
        const amountTotalText = $(row).find('.valor').text().trim();
        const amountTotal = parseFloat(amountTotalText.replace(',', '.'));

        const item = { title, code, qtd, amountUnit, amountTotal };
        itemsArray.push(item);
    });

    // Consolidar os itens duplicados
    return consolidateItems(itemsArray);
}

// Rota POST para processar a imagem diretamente da memória e retornar os dados consolidados
app.post('/process', upload.single('image'), async (req, res) => {
    try {
        const imageBuffer = req.file.buffer; // A imagem já está disponível como buffer

        // Processar a imagem e obter os dados consolidados
        const consolidatedItems = await processImageAndExtractData(imageBuffer);

        // Retornar os dados consolidados em formato JSON
        res.json(consolidatedItems);
    } catch (error) {
        console.error('Erro ao processar a imagem:', error);
        res.status(500).send({ error: 'Erro ao processar a imagem' });
    }
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
