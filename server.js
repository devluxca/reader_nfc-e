const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const jsQR = require('jsqr');
const ZXing = require('node-zxing')();
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // Para gerar um nome único para o arquivo temporário

// Configurar Multer para armazenar a imagem em memória, não em disco
const upload = multer({ storage: multer.memoryStorage() });

// Criar o app Express
const app = express();

// Função para consolidar itens duplicados
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

// Função para processar a imagem e obter os dados consolidados
async function processImageAndExtractData(imageBuffer) {
    // Carregar a imagem e convertê-la para um formato adequado para o jsQR (RGBA)
    const { data, info } = await sharp(imageBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    // Detectar o QR Code usando jsQR
    const qrCode = jsQR(new Uint8ClampedArray(data), info.width, info.height);

    if (!qrCode) {
        throw new Error('QR Code não detectado');
    }

    const { topLeftCorner, bottomRightCorner } = qrCode.location;
    const padding = 20;

    // Realizar o crop com base nas coordenadas do QR Code
    const croppedBuffer = await sharp(imageBuffer)
        .extract({
            left: Math.max(0, Math.round(topLeftCorner.x - padding)),
            top: Math.max(0, Math.round(topLeftCorner.y - padding)),
            width: Math.round(bottomRightCorner.x - topLeftCorner.x + padding * 2),
            height: Math.round(bottomRightCorner.y - topLeftCorner.y + padding * 2)
        })
        .toBuffer();

    // Salvar o buffer como um arquivo temporário
    const tempFilePath = path.join(__dirname, 'uploads', `${uuidv4()}.jpeg`);
    fs.writeFileSync(tempFilePath, croppedBuffer);

    // Decodificar o QR Code do arquivo temporário
    const result = await new Promise((resolve, reject) => {
        ZXing.decode(tempFilePath, (err, out) => {
            if (err) {
                return reject(err);
            }
            resolve(out);
        });
    });

    // Apagar o arquivo temporário após a leitura
    fs.unlinkSync(tempFilePath);

    // Fazer a requisição para o link extraído do QR Code e processar o HTML
    const htmlContent = await axios.get(result).then(res => res.data);

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
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
