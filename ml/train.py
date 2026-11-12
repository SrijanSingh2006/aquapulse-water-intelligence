"""Reproducible synthetic benchmark. No customer data or production-performance claim."""
from pathlib import Path
import json
import hashlib
import math
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, precision_score, recall_score, f1_score

ROOT = Path(__file__).resolve().parent
SEED = 2027
SITES = [
    dict(id='BLR-01', name='Bengaluru Works', city='Bengaluru', sector='Manufacturing', baselineFlow=42, assetId='blr-ct-01'),
    dict(id='PUN-02', name='Pune Manufacturing', city='Pune', sector='Manufacturing', baselineFlow=35, assetId='pun-ct-01'),
    dict(id='CHE-03', name='Chennai Foods', city='Chennai', sector='Food & beverage', baselineFlow=28, assetId='che-ct-01'),
]
BASELINES = {s['id']: s['baselineFlow'] for s in SITES}

def features(r):
    hour = int(r['timestamp'][11:13])
    phase = 2 * math.pi * hour / 24
    base = BASELINES[r['siteId']]
    return [base, base*r['productionIndex'], base*math.sin(phase), base*math.cos(phase), base*(r['temperatureC']-28)]

def generate():
    rng = np.random.default_rng(SEED)
    rows = []
    start = np.datetime64('2026-10-08T19:00:00')
    for step in range(35*24):
        stamp = str(start + np.timedelta64(step, 'h')) + 'Z'
        hour = int(stamp[11:13]); phase = 2*math.pi*hour/24
        for site in SITES:
            production = np.clip(0.78 + 0.14*math.sin(phase-0.5) + rng.normal(0, 0.035), 0.4, 1.1)
            temp = 28+3.5*math.sin(phase-1)+rng.normal(0,0.6)
            base = site['baselineFlow']
            flow = base*(0.72+0.26*production+0.05*math.sin(phase)+0.012*(temp-28))+rng.normal(0,0.55)
            conductivity=1200+45*math.sin(phase)+rng.normal(0,28)
            ph=7.3+rng.normal(0,0.07)
            label='normal'
            # Anomalies appear only after training, so detectors never fit injected faults.
            if step>=21*24 and rng.random()<0.075:
                if rng.random()<0.55:
                    flow += base*rng.uniform(.26,.55); label='leak'
                else:
                    conductivity += rng.uniform(450,950); ph -= rng.uniform(.45,.9); label='scaling'
            rows.append(dict(timestamp=stamp,siteId=site['id'],assetId=site['assetId'],flowM3h=round(float(flow),4),conductivityUsCm=round(float(conductivity),3),temperatureC=round(float(temp),3),ph=round(float(ph),4),productionIndex=round(float(production),4),label=label,step=step))
    return rows

def anomaly_features(r, reg):
    expected=float(reg.predict([features(r)])[0])
    return [(r['flowM3h']-expected)/BASELINES[r['siteId']], r['conductivityUsCm'],r['ph']]

def clean(r): return {k:v for k,v in r.items() if k not in ('label','step')}

def main():
    rows=generate()
    train=[r for r in rows if r['step']<21*24]
    calibration=[r for r in rows if 21*24<=r['step']<28*24]
    test=[r for r in rows if r['step']>=28*24]
    normal_cal=[r for r in calibration if r['label']=='normal']
    normal_test=[r for r in test if r['label']=='normal']
    reg=Ridge(alpha=0.1).fit([features(r) for r in train],[r['flowM3h'] for r in train])
    detector=IsolationForest(n_estimators=48,max_samples=128,contamination='auto',random_state=SEED,n_jobs=1).fit([anomaly_features(r,reg) for r in train])
    cal_scores=-detector.score_samples([anomaly_features(r,reg) for r in normal_cal])
    cal_all_scores=-detector.score_samples([anomaly_features(r,reg) for r in calibration])
    cal_labels=np.array([r['label']!='normal' for r in calibration])
    # Threshold tuning uses calibration labels only, never held-out test labels.
    candidates=np.unique(cal_all_scores)
    threshold=float(max(candidates,key=lambda t:(f1_score(cal_labels,cal_all_scores>t,zero_division=0),t)))
    scores=-detector.score_samples([anomaly_features(r,reg) for r in test])
    actual=np.array([r['label']!='normal' for r in test]); predicted=scores>threshold
    predictions=reg.predict([features(r) for r in normal_test])
    residuals=np.abs(np.array([r['flowM3h'] for r in normal_cal])-reg.predict([features(r) for r in normal_cal]))
    radius=float(np.quantile(residuals,.95))
    trees=[]
    for est in detector.estimators_:
        t=est.tree_
        trees.append(dict(left=t.children_left.tolist(),right=t.children_right.tolist(),feature=t.feature.tolist(),threshold=t.threshold.tolist(),samples=t.n_node_samples.tolist()))
    artifact=dict(version='1.0.0',seed=SEED,source='Deterministic synthetic industrial-water telemetry; not Ecolab or customer data.',sites=SITES,forecast=dict(algorithm='Ridge regression',featureNames=['baselineFlow','baselineFlow × productionIndex','baselineFlow × sin(hour)','baselineFlow × cos(hour)','baselineFlow × (temperatureC − 28)'],coefficients=reg.coef_.tolist(),intercept=float(reg.intercept_),intervalRadiusM3h=radius),anomaly=dict(algorithm='Isolation Forest',featureNames=['flow residual / baseline','conductivityUsCm','ph'],threshold=threshold,maxSamples=128,trees=trees))
    metrics=dict(dataset='Synthetic benchmark only',seed=SEED,split=dict(strategy='Chronological, 21 days train / 7 days calibration / 7 days test',trainRows=len(train),calibrationRows=len(calibration),testRows=len(test),trainStart=train[0]['timestamp'],trainEnd=train[-1]['timestamp'],calibrationStart=calibration[0]['timestamp'],calibrationEnd=calibration[-1]['timestamp'],testStart=test[0]['timestamp'],testEnd=test[-1]['timestamp']),forecast=dict(algorithm='Ridge regression',maeM3h=float(mean_absolute_error([r['flowM3h'] for r in normal_test],predictions)),rmseM3h=float(math.sqrt(mean_squared_error([r['flowM3h'] for r in normal_test],predictions))),intervalRadiusM3h=radius,intervalCoverage=float(np.mean(np.abs(predictions-np.array([r['flowM3h'] for r in normal_test]))<=radius)),evaluatedRows=len(normal_test),evaluation='Healthy-demand regression on held-out normal rows with observed exogenous variables; not a rolling 24-hour forecast backtest.'),anomaly=dict(algorithm='Isolation Forest',precision=float(precision_score(actual,predicted,zero_division=0)),recall=float(recall_score(actual,predicted,zero_division=0)),f1=float(f1_score(actual,predicted,zero_division=0)),threshold=threshold,thresholdSelection='Maximum F1 on labeled calibration split only',truePositives=int(np.sum(actual & predicted)),falsePositives=int(np.sum(~actual & predicted)),falseNegatives=int(np.sum(actual & ~predicted)),testAnomalies=int(np.sum(actual))))
    fixture_rows=[normal_test[15],normal_test[25]]+[r for r in test if r['label']!='normal'][:5]
    fixtures=[]
    for r in fixture_rows:
        fixtures.append(dict(reading=clean(r),expectedFlowM3h=float(reg.predict([features(r)])[0]),anomalyScore=float(-detector.score_samples([anomaly_features(r,reg)])[0]),isAnomaly=bool(-detector.score_samples([anomaly_features(r,reg)])[0]>threshold)))
    # Demo: fixed seven-day data window, deterministic normal telemetry and conspicuous final faults.
    demo=[]
    for r in rows[-7*24*3:]:
        reading=clean(r)
        # Remove random faults from demo; reconstruct a clean expected value + deterministic noise.
        noise=.45*math.sin(r['step']*1.73+BASELINES[r['siteId']])
        reading['flowM3h']=round(float(reg.predict([features(r)])[0])+noise,3)
        reading['conductivityUsCm']=round(1200+40*math.sin(r['step']*.26),3)
        reading['ph']=round(7.3+.045*math.sin(r['step']*.37),3)
        if r['step']>=35*24-10 and r['siteId']=='BLR-01': reading['flowM3h']=round(reading['flowM3h']+16,3)
        if r['step']>=35*24-7 and r['siteId']=='CHE-03':
            reading['conductivityUsCm']=round(reading['conductivityUsCm']+750,3)
            reading['ph']=6.55
        demo.append(reading)
    for name,value in [('model.json',artifact),('metrics.json',metrics),('parity-fixtures.json',fixtures),('demo-readings.json',demo)]:
        (ROOT/name).write_text(json.dumps(value,indent=None,separators=(',',':'))+'\n')
    # Fixed monitoring reference uses healthy TRAINING observations only. It is never
    # updated from calibration, test, demo faults, or uploaded telemetry.
    def monitoring_features(r):
        return dict(flowResidualRatio=(r['flowM3h']-float(reg.predict([features(r)])[0]))/BASELINES[r['siteId']],
                    conductivityUsCm=r['conductivityUsCm'], ph=r['ph'],
                    productionIndex=r['productionIndex'], temperatureC=r['temperatureC'])
    def reference_features(population):
        extracted=[monitoring_features(r) for r in population]
        result=[]
        labels=dict(flowResidualRatio='Normalized flow residual',conductivityUsCm='Conductivity',
                    ph='pH',productionIndex='Production index',temperatureC='Temperature')
        for name,label in labels.items():
            values=np.asarray([r[name] for r in extracted],dtype=float)
            inner=np.unique(np.quantile(values,np.arange(1,10)/10))
            counts,_=np.histogram(values,bins=np.concatenate(([-np.inf],inner,[np.inf])))
            result.append(dict(name=name,label=label,mean=float(np.mean(values)),
                               edges=[None]+inner.tolist()+[None],
                               proportions=(counts/len(values)).tolist()))
        return result
    reference=dict(version='1.0.0',modelVersion=artifact['version'],
                   modelSha256=hashlib.sha256((ROOT/'model.json').read_bytes()).hexdigest(),
                   source='Frozen healthy synthetic training data only; not Ecolab or customer data.',
                   trainingRows=len(train),trainingStart=train[0]['timestamp'],trainingEnd=train[-1]['timestamp'],
                   minSamples=30,psiThresholds=dict(stable=0.1,watch=0.25),smoothingEpsilon=0.0001,
                   features=reference_features(train),
                   bySite={site['id']:dict(rows=sum(r['siteId']==site['id'] for r in train),
                            features=reference_features([r for r in train if r['siteId']==site['id']])) for site in SITES})
    (ROOT/'reference.json').write_text(json.dumps(reference,indent=None,separators=(',',':'))+'\n')
    print(json.dumps(metrics,indent=2))

if __name__=='__main__': main()
