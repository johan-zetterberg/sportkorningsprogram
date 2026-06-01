export function getXmlElements(element, tagName) {
    return Array.from(element?.getElementsByTagName?.(tagName) || []);
}

export function getXmlText(element, tagName) {
    return element?.getElementsByTagName?.(tagName)?.[0]?.textContent?.trim() || '';
}

export function getXmlParseError(xml) {
    const parserError = xml?.getElementsByTagName?.('parsererror')?.[0];
    return parserError?.textContent?.trim() || '';
}

export function parseAdminXml(text, {
    requiredRootTag = '',
    parser = null
} = {}) {
    const activeParser = parser || (typeof DOMParser !== 'undefined' ? new DOMParser() : null);
    if (!activeParser) {
        throw new Error('XML-import kraver DOMParser och maste koras i webblasaren.');
    }

    const xml = activeParser.parseFromString(String(text || ''), 'application/xml');
    const parseError = getXmlParseError(xml);
    if (parseError) {
        throw new Error(`XML-filen kunde inte lasas: ${parseError}`);
    }

    if (requiredRootTag && !xml.getElementsByTagName(requiredRootTag)[0]) {
        throw new Error(`Okant XML-format: filen saknar <${requiredRootTag}>-taggen.`);
    }

    return xml;
}
