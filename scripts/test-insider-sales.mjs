import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  lastClosedSessionDate,
  parseForm144Xml,
  parseForm4Xml,
  rebuildRadar
} from './refresh-insider-sales.mjs';

const form4 = parseForm4Xml(`
  <ownershipDocument>
    <issuer><issuerTradingSymbol>TEST</issuerTradingSymbol></issuer>
    <reportingOwner><reportingOwnerId><rptOwnerName>Example Person</rptOwnerName></reportingOwnerId></reportingOwner>
    <aff10b5One>1</aff10b5One>
    <nonDerivativeTable>
      <nonDerivativeTransaction>
        <transactionDate><value>2026-08-25</value></transactionDate>
        <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
        <transactionAmounts>
          <transactionShares><value>1250</value></transactionShares>
          <transactionPricePerShare><value>80.40</value></transactionPricePerShare>
          <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
        </transactionAmounts>
      </nonDerivativeTransaction>
      <nonDerivativeTransaction>
        <transactionDate><value>2026-08-25</value></transactionDate>
        <transactionCoding><transactionCode>F</transactionCode></transactionCoding>
        <transactionAmounts>
          <transactionShares><value>999</value></transactionShares>
          <transactionPricePerShare><value>80.40</value></transactionPricePerShare>
          <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
        </transactionAmounts>
      </nonDerivativeTransaction>
    </nonDerivativeTable>
  </ownershipDocument>
`, { ticker: 'TEST', accessionNumber: 'test-4' });

assert.equal(form4.owner, 'Example Person');
assert.equal(form4.transactions.length, 1);
assert.deepEqual(form4.transactions[0], {
  date: '2026-08-25',
  ticker: 'TEST',
  owner: 'Example Person',
  ownerKey: 'example person',
  shares: 1250,
  valueUsd: 100500,
  valueCny: 0,
  planValueUsd: 100500,
  accessionNumber: 'test-4',
  filingDate: '',
  sourceUrl: ''
});

const form144 = parseForm144Xml(`
  <own:edgarSubmission xmlns:own="http://www.sec.gov/edgar/ownership">
    <own:nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold>Person Example</own:nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold>
    <own:securitiesInformation>
      <own:noOfUnitsSold>1250</own:noOfUnitsSold>
      <own:aggregateMarketValue>101000</own:aggregateMarketValue>
      <own:approxSaleDate>08/25/2026</own:approxSaleDate>
    </own:securitiesInformation>
  </own:edgarSubmission>
`, { ticker: 'TEST', accessionNumber: 'test-144' });

assert.equal(form144.owner, 'Person Example');
assert.equal(form144.notices.length, 1);
assert.equal(form144.notices[0].date, '2026-08-25');
assert.equal(form144.notices[0].shares, 1250);
assert.equal(form144.notices[0].valueUsd, 101000);
assert.equal(form144.notices[0].ownerKey, 'example person');

assert.equal(lastClosedSessionDate(new Date('2026-08-28T10:00:00Z'), 'cn'), '2026-08-28');
assert.equal(lastClosedSessionDate(new Date('2026-08-28T10:00:00Z'), 'us'), '2026-08-27');
assert.equal(lastClosedSessionDate(new Date('2026-08-30T12:00:00Z'), 'us'), '2026-08-28');

const data = JSON.parse(await readFile(new URL('../data/insider-sales.json', import.meta.url), 'utf8'));
const state = JSON.parse(await readFile(new URL('../data/insider-sales-state.json', import.meta.url), 'utf8'));
const rebuilt = rebuildRadar(data, state);
const windowDays = Math.round((Date.parse(rebuilt.window.end) - Date.parse(rebuilt.window.start)) / 86400000) + 1;
assert.equal(windowDays, 365);
assert.equal(rebuilt.window.end, [state.lastSecSessionDate, state.lastCninfoSessionDate, data.window.end].sort().at(-1));
assert.equal(rebuilt.automation.enabled, true);
assert.ok(rebuilt.timeline.length > 0);
assert.ok(rebuilt.timeline[0].date <= rebuilt.window.end);

const covered = rebuilt.companies.filter((company) => company.coverage === 'covered');
const executedShares = covered.reduce((total, company) => total + Number(company.executed?.shares || 0), 0);
const executedValueUsd = covered.reduce((total, company) => total + Number(company.executed?.valueUsd || 0), 0);
const pendingShares = covered.reduce((total, company) => total + Number(company.pending?.shares || 0), 0);
assert.equal(rebuilt.summary.executedShares, executedShares);
assert.ok(Math.abs(rebuilt.summary.executedValueUsd - executedValueUsd) < 0.01);
assert.equal(rebuilt.summary.pendingShares, pendingShares);

const timelineExecuted = rebuilt.timeline.filter((item) => item.kind.startsWith('executed'));
const timelinePending = rebuilt.timeline.filter((item) => item.kind === 'pending');
assert.equal(timelineExecuted.reduce((total, item) => total + item.shares, 0), executedShares);
assert.equal(timelinePending.reduce((total, item) => total + item.shares, 0), pendingShares);

console.log(`validated insider-sales parser, 365-day window, ${state.secFilings.length} live Form 4 filings and ${state.form144Filings.length} live Form 144 filings`);
