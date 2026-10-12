function normalize(text) {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
}

function classifyEvent(event) {
    const text = normalize(`${event.heading}\n${event.description}`);
    if (/\bsorteo\b|\bganador(?:es)?\b|\bconcurso\b/.test(text)) {
        return { status: 'excluded', reason: 'La entrega depende de un sorteo o concurso' };
    }
    // Negaciones explícitas de compra no convierten una actividad gratuita en una promoción de compra.
    const purchaseText = text
        .replace(/no (?:esta|estan) a la venta/g, '')
        .replace(/no (?:se puede|puede|pueden) comprar/g, '')
        .replace(/(?:sin (?:necesidad de )?(?:compra|comprar)|no (?:requiere|es necesari[ao]|necesitas) (?:realizar )?(?:una |ninguna )?(?:compra|comprar))/g, '');
    if (/\bcompr(?:a|as|ar|ando)\b|\badquir(?:ir|iendo|e)\b|regalo con (?:tu|la) compra/.test(purchaseText)) {
        return { status: 'excluded', reason: 'El evento está relacionado con compras' };
    }
    const takeHome = /llev[a-z]*(?:\s+[a-z]+){0,6}\s+(?:a\s+)?casa|para llevar|make[ -]?and[ -]?take/.test(text);
    const model = /\bconstru(?:ye|ir|ccion|cciones)\b|\bmodelo\b/.test(text);
    const giveaway = /gratis|gratuit[a-z]*|por orden de llegada|(?:un|1) modelo.{0,100}por persona|no (?:esta|estan) a la venta|no (?:se puede|puede) comprar/.test(text);
    if (takeHome && model && giveaway) {
        return { status: 'confirmed', reason: 'Construcción para llevar a casa, con condiciones de entrega y sin compra indicada' };
    }
    if (takeHome || /regalo|obsequio|sorpresa|gratuit|gratis/.test(text)) {
        return { status: 'review', reason: 'No se confirma la entrega gratuita de una construcción para llevar' };
    }
    return { status: 'excluded', reason: 'No anuncia una construcción gratuita para llevar' };
}

module.exports = { classifyEvent, normalize };
