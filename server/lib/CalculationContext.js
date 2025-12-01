import { createContext, useContext, useState, useEffect, useRef } from 'react';

const CalculationContext = createContext();

const defaultFactors = { flat: 1, spike: 2, peak: 1.7, valley: 0.3, deep: 0.1 };

export function CalculationProvider({ children }) {
  // State from index.jsx
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState('');
  const [expected, setExpected] = useState('');
  const [parsed, setParsed] = useState(null);
  const [months, setMonths] = useState([]);
  const [monthIdx, setMonthIdx] = useState(0);
  const [scope, setScope] = useState('汇总(全部)');
  const [consumption, setConsumption] = useState(null);
  const [groups, setGroups] = useState(null);
  const [basePrices, setBasePrices] = useState(null);
  const [prices, setPrices] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [selected, setSelected] = useState('__all__');
  const [error, setError] = useState('');
  const [peakValleyCount, setPeakValleyCount] = useState(3);
  const [calendarConfigs, setCalendarConfigs] = useState(() => Array(12).fill(3));
  const [currentCalendarMonth, setCurrentCalendarMonth] = useState(0);
  const [templates, setTemplates] = useState([]);
  const [templateSelectedId, setTemplateSelectedId] = useState('');
  const [factors, setFactors] = useState(defaultFactors);

  // Load calendar configs from localStorage (client-side only)
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem('calendarConfigs') : null;
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length === 12) {
          const fixed = arr.map(v => {
            const n = parseInt(v, 10);
            return (!isNaN(n) && n > 0 && n * 2 <= 24) ? n : 3;
          });
          setCalendarConfigs(fixed);
        }
      }
    } catch { }
  }, []);

  // Save calendar configs to localStorage
  useEffect(() => {
    try {
      if (Array.isArray(calendarConfigs) && calendarConfigs.length === 12) {
        window.localStorage.setItem('calendarConfigs', JSON.stringify(calendarConfigs));
      }
    } catch { }
  }, [calendarConfigs]);

  const value = {
    file, setFile,
    fileName, setFileName,
    expected, setExpected,
    parsed, setParsed,
    months, setMonths,
    monthIdx, setMonthIdx,
    scope, setScope,
    consumption, setConsumption,
    groups, setGroups,
    basePrices, setBasePrices,
    prices, setPrices,
    companies, setCompanies,
    selected, setSelected,
    error, setError,
    peakValleyCount, setPeakValleyCount,
    calendarConfigs, setCalendarConfigs,
    currentCalendarMonth, setCurrentCalendarMonth,
    templates, setTemplates,
    templateSelectedId, setTemplateSelectedId,
    factors, setFactors
  };

  return (
    <CalculationContext.Provider value={value}>
      {children}
    </CalculationContext.Provider>
  );
}

export function useCalculation() {
  return useContext(CalculationContext);
}
