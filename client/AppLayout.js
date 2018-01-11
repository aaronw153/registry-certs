// @flow
/* eslint react/display-name: 0 */

import React, {
  type Element as ReactElement,
  type ChildrenArray as ReactChildrenArray,
} from 'react';
import Link from 'next/link';

import headerHtml from '../templates/header.html';
import navigationHtml from '../templates/navigation.html';
import footerHtml from '../templates/footer.html';

import Nav, { type Props as NavProps } from './common/Nav';
import { FREEDOM_RED } from './common/style-constants';

type Props = {|
  children: ReactChildrenArray<ReactElement<*>>,
  navProps: ?NavProps,
|};

export default function AppLayout({ children, navProps }: Props) {
  // TODO(fin): remove wrapper <div> and return an array w/ React 16
  return (
    <div>
      <a href="#content" className="a11y--h">
        Jump to content
      </a>

      <input
        type="checkbox"
        id="brg-tr"
        className="brg-tr"
        aria-hidden="true"
      />
      <nav
        className="nv-m"
        dangerouslySetInnerHTML={{ __html: navigationHtml }}
        aria-label="Boston.gov menu"
      />

      <div className="mn--full-ie">
        <div
          className={`mn mn--full ${navProps ? 'mn--nv-s' : ''}`}
          style={{ zIndex: 2 }}
        >
          <input
            type="checkbox"
            id="s-tr"
            className="s-tr"
            aria-hidden="true"
          />
          <header
            className="h"
            role="banner"
            dangerouslySetInnerHTML={{ __html: headerHtml }}
          />

          {navProps && <Nav {...navProps} />}

          <nav className="brc p-a300" aria-label="Breadcrumbs">
            <ul className="brc-l">
              <li className="brc-l-i">
                <a href="https://www.boston.gov/">Home</a>
                <span className="brc-s"> › </span>
              </li>
              <li className="brc-l-i">
                <a href="https://www.boston.gov/departments">Departments</a>
                <span className="brc-s"> › </span>
              </li>
              <li className="brc-l-i">
                <a href="https://www.boston.gov/departments/registry">
                  Registry: Birth, death, and marriage
                </a>
                <span className="brc-s"> › </span>
              </li>
              <li className="brc-l-i">
                <Link href="/death">
                  <a>Death certificates</a>
                </Link>
              </li>
            </ul>
          </nav>

          <a name="content" />
          <main className="b-ff">{children}</main>
        </div>
      </div>

      <footer
        className="ft"
        style={{ position: 'relative', zIndex: 2 }}
        dangerouslySetInnerHTML={{ __html: footerHtml }}
      />

      <style jsx>{`
        .brc li:last-child a {
          color: ${FREEDOM_RED};
        }
      `}</style>
    </div>
  );
}
