/* ==========================================================================
   Edge function: /api/liga
   --------------------------------------------------------------------------
   Mesma consulta da função `netlify/functions/liga.mjs`, mas rodando na borda.

   Por que existe: as funções normais do Netlify rodam nos Estados Unidos, e a
   LigaPokémon responde 403 para elas (bloqueio por IP de datacenter / país).
   Do Brasil funciona. A edge function roda na região mais próxima de quem
   acessa — para quem está no Brasil, um servidor no Brasil — então o pedido
   sai de um endereço que a Liga aceita.

   O código de leitura é o MESMO arquivo, importado aqui. Ele só usa recursos
   padrão da web (fetch, Response, URL, Map), que existem nos dois ambientes,
   então não há duas versões para manter em sincronia.

   Se a borda também for barrada, o app cai sozinho para /.netlify/functions/liga.
   ========================================================================== */

import handler from '../functions/liga.mjs';

export default async (request) => handler(request);

export const config = { path: '/api/liga' };
