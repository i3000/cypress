import '../../spec_helper'
import _ from 'lodash'
import 'chai-as-promised' // for the types!
import chalk from 'chalk'
import { connect } from '@packages/network'
import CRI from 'chrome-remote-interface'
import { expect } from 'chai'
import humanInterval from 'human-interval'
import protocol from '../../../lib/browsers/protocol'
import sinon from 'sinon'
import snapshot from 'snap-shot-it'
import stripAnsi from 'strip-ansi'
import { stripIndents } from 'common-tags'

describe('lib/browsers/protocol', () => {
  // protocol connects explicitly to this host
  const host = '127.0.0.1'

  context('._getDelayMsForRetry', () => {
    it('retries as expected for up to 20 seconds', () => {
      const log = sinon.spy(console, 'log')

      let delays = []
      let delay: number
      let i = 0

      while ((delay = protocol._getDelayMsForRetry(i))) {
        delays.push(delay)
        i++
      }

      expect(_.sum(delays)).to.eq(humanInterval('20 seconds'))

      log.getCalls().forEach((log, i) => {
        const line = stripAnsi(log.args[0])

        expect(line).to.include(`Failed to connect to Chrome, retrying in 1 second (attempt ${i + 18}/32)`)
      })

      snapshot(delays)
    })
  })

  context('.getWsTargetFor', () => {
    it('rejects if CDP connection fails', () => {
      const innerErr = new Error('cdp connection failure')

      sinon.stub(connect, 'createRetryingSocket').callsArgWith(1, innerErr)
      const p = protocol.getWsTargetFor(12345)

      const expectedError = stripIndents`
        Cypress failed to make a connection to the Chrome DevTools Protocol after retrying for 20 seconds.

        This usually indicates there was a problem opening the Chrome browser.

        The CDP port requested was ${chalk.yellow('12345')}.

        Error details:
      `

      expect(p).to.eventually.be.rejected
      .and.property('message').include(expectedError)
      .and.include(innerErr.message)
    })

    it('returns the debugger URL of the first about:blank tab', async () => {
      const targets = [
        {
          type: 'page',
          url: 'chrome://newtab',
          webSocketDebuggerUrl: 'foo',
        },
        {
          type: 'page',
          url: 'about:blank',
          webSocketDebuggerUrl: 'bar',
        },
      ]

      const end = sinon.stub()

      sinon.stub(CRI, 'List').withArgs({ host, port: 12345 }).resolves(targets)
      sinon.stub(connect, 'createRetryingSocket').callsArgWith(1, null, { end })

      const p = protocol.getWsTargetFor(12345)

      await expect(p).to.eventually.equal('bar')
      expect(end).to.be.calledOnce
    })
  })

  context('CRI.List', () => {
    it('retries several times if starting page cannot be found', async () => {
      const port = 1234
      const targets = [
        {
          type: 'page',
          url: 'chrome://newtab',
          webSocketDebuggerUrl: 'foo',
        },
        {
          type: 'page',
          url: 'about:blank',
          webSocketDebuggerUrl: 'ws://debug-url',
        },
      ]

      const end = sinon.stub()

      sinon.stub(connect, 'createRetryingSocket').callsArgWith(1, null, { end })

      const criList = sinon.stub(CRI, 'List')
      .withArgs({ host, port })
      .onFirstCall().resolves([])
      .onSecondCall().resolves([])
      .onThirdCall().resolves(targets)

      const targetUrl = await protocol.getWsTargetFor(port)

      expect(criList).to.have.been.calledThrice
      expect(targetUrl).to.equal('ws://debug-url')
    })
  })
})
