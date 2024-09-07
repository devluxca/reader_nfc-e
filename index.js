const sharp = require('sharp');
const ZXing = require('node-zxing')();
const axios = require('axios');
const fs = require('fs');
const cheerio = require('cheerio');
const jsQR = require('jsqr');

// Caminho da imagem
const imagePath = './file/nfc-e-1.jpeg';
const croppedImagePath = './cropped_qrcode.jpeg';

function decodeQRCodeFromImage(imagePath) {
    return new Promise((resolve, reject) => {
        // Use o ZXing para decodificar a imagem
        ZXing.decode(imagePath, (err, out) => {
            if (err) {
                console.error('Erro ao decodificar o QR Code:', err);
                reject(err);
            } else {
                console.log('Texto do QR Code:', out);
                resolve(out);
            }
        });
    });
}

function consolidateItems(items) {
    const itemMap = {};

    items.forEach(item => {
        // Cria uma chave única baseada no title e code
        const key = `${item.title}-${item.code}`;

        if (itemMap[key]) {
            // Se o item já existe, soma a quantidade e atualiza o valor total
            itemMap[key].qtd += item.qtd;
            itemMap[key].amountTotal += item.amountTotal;
        } else {
            // Se não existe, adiciona ao mapa
            itemMap[key] = { ...item };
        }
    });

    // Converte o mapa de volta para um array
    const consolidatedItems = Object.values(itemMap);

    // Opcional: Se quiser formatar os números de volta para strings com duas casas decimais e vírgula
    consolidatedItems.forEach(item => {
        item.qtd = item.qtd.toString();
        item.amountUnit = item.amountUnit.toFixed(2).replace('.', ',');
        item.amountTotal = item.amountTotal.toFixed(2).replace('.', ',');
    });

    return consolidatedItems;
}


function fetchAndProcessTable(url) {
    axios.get(url)
        .then(response => {
            const htmlContent = response.data;

            // Carregar o HTML no cheerio para processar
            const $ = cheerio.load(htmlContent);

            // Pegar todas as linhas (<tr>) da tabela
            const rows = $('tr[id^="Item"]'); // Seleciona todas as <tr> que possuem id começando com "Item"

            // Array para armazenar os objetos dos itens
            const itemsArray = [];

            // Iterar sobre cada linha da tabela e extrair os dados
            rows.each((index, row) => {
                const title = $(row).find('.txtTit').first().text().trim(); // Nome do produto

                // Extrair o código do produto
                const code = $(row).find('.RCod').text().replace(/[^0-9]/g, '').trim();

                // Para a quantidade
                const qtdText = $(row).find('.Rqtd').text().replace('Qtde.:', '').trim();
                const qtd = parseFloat(qtdText.replace(',', '.')); // Converter para número

                // Para o valor unitário
                const amountUnitText = $(row).find('.RvlUnit').text().replace('Vl. Unit.:', '').trim();
                const amountUnit = parseFloat(amountUnitText.replace(',', '.')); // Converter para número

                // Valor total
                const amountTotalText = $(row).find('.valor').text().trim();
                const amountTotal = parseFloat(amountTotalText.replace(',', '.')); // Converter para número

                // Criar objeto para o item
                const item = {
                    title,
                    code,
                    qtd,
                    amountUnit,
                    amountTotal
                };

                // Adicionar ao array de itens
                itemsArray.push(item);
            });

            // Função para consolidar itens duplicados
            const consolidatedItems = consolidateItems(itemsArray);

            // Exibir os itens consolidados
            console.log('Itens consolidados:', consolidatedItems);

            // Salvar os itens consolidados em um arquivo JSON
            fs.writeFile('./consolidated_items.json', JSON.stringify(consolidatedItems, null, 2), (err) => {
                if (err) {
                    console.error('Erro ao salvar o arquivo JSON:', err);
                } else {
                    console.log('Arquivo JSON de itens consolidados salvo com sucesso!');
                }
            });
        })
        .catch(err => {
            console.error('Erro ao buscar o HTML:', err);
        });
}

// Função para fazer o request do link e salvar o HTML localmente
function fetchAndSaveHTML(url) {
    axios.get(url)
        .then(response => {
            const htmlContent = response.data;

            // Carregar o HTML no cheerio para processar
            const $ = cheerio.load(htmlContent);

            // Pegar o primeiro elemento <table> do HTML
            const table = $('table').first();

            if (table.length === 0) {
                console.log('Nenhuma tabela encontrada no HTML.');
                return;
            }

            // Extrair o HTML da tabela
            const tableHtml = table.html();

            // Salvar o conteúdo da tabela em um arquivo
            fs.writeFile('./table_content.html', tableHtml, (err) => {
                if (err) {
                    console.error('Erro ao salvar o HTML da tabela:', err);
                } else {
                    console.log('HTML da tabela salvo com sucesso!');
                }
            });
        })
        .catch(err => {
            console.error('Erro ao buscar o HTML:', err);
        });
}

// Carregar a imagem e convertê-la para um formato adequado para o jsQR (RGBA)
sharp(imagePath)
    .ensureAlpha() // Garante que a imagem tenha canal alpha
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => {
        // Detectar o QR Code usando jsQR
        const qrCode = jsQR(new Uint8ClampedArray(data), info.width, info.height);

        if (qrCode) {
            console.log('QR Code detectado!', qrCode);

            // Coordenadas do QR Code
            const { topLeftCorner, bottomRightCorner } = qrCode.location;
            const padding = 20;
            // Realizar o crop com base nas coordenadas do QR Code
            sharp(imagePath)
                .extract({
                    left: Math.max(0, Math.round(topLeftCorner.x - padding)), // Subtrai o padding, sem sair da imagem
                    top: Math.max(0, Math.round(topLeftCorner.y - padding)), // Subtrai o padding, sem sair da imagem
                    width: Math.min(info.width - topLeftCorner.x, Math.round(bottomRightCorner.x - topLeftCorner.x + padding * 2)), // Adiciona padding na largura
                    height: Math.min(info.height - topLeftCorner.y, Math.round(bottomRightCorner.y - topLeftCorner.y + padding * 2)) // Adiciona padding na altura
                })
                .toFile(croppedImagePath)
                .then(() => {
                    console.log('Imagem recortada com sucesso! Verifique:', croppedImagePath);
                    decodeQRCodeFromImage(croppedImagePath)
                    .then(result => {
                        console.log('Conteúdo do QR Code:', result);
                        fetchAndSaveHTML(result);
                        fetchAndProcessTable(result)
                    })
                    .catch(err => {
                        console.error('Falha ao decodificar o QR Code:', err);
                    });
                })
                .catch(err => {
                    console.error('Erro ao recortar a imagem:', err);
                });
        } else {
            console.log('QR Code não detectado.');
        }
    })
    .catch(err => {
        console.error('Erro ao processar a imagem:', err);
    });
